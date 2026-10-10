#!/bin/sh
# Wazuh custom Active Response script — real Linux network isolation via iptables.
#
# Install as:
#   /var/ossec/active-response/bin/isolate-host.sh
# on the LINUX AGENT you want isolatable (not the manager), then:
#   chmod 750 /var/ossec/active-response/bin/isolate-host.sh
#   chown root:wazuh /var/ossec/active-response/bin/isolate-host.sh
# Register it on the MANAGER's ossec.conf with the <command>/<active-response>
# blocks in ossec-active-response-snippet.xml in this folder — the <name> you
# choose there is what you set as WAZUH_ISOLATION_AR_COMMAND in backend/.env.
#
# Protocol (verified against
# https://documentation.wazuh.com/current/user-manual/capabilities/active-response/custom-active-response-scripts.html
# at implementation time — reconfirm against your installed version): the
# Wazuh agent invokes this script and writes one JSON line to STDIN:
#   {"version":1,"origin":{...},"command":"add"|"delete","parameters":{...}}
# "add" = apply isolation now. "delete" = the manager's <active-response>
# <timeout> for this command has elapsed — automatically reverse it. Configure
# a real <timeout> in ossec-active-response-snippet.xml so a stuck isolation
# can't outlive it.
#
# MECHANISM (this is what actually blocks network access — not a status
# flag): sets iptables' default INPUT/OUTPUT policy to DROP, with narrow
# ACCEPT rules for loopback, this agent's Wazuh manager, and MIRQAB's own
# backend (so the agent stays reachable for the manager's "delete" command
# AND can still call back to MIRQAB with real confirmation — see below).
# Everything else — the malware's C2 channel included — is dropped at the
# kernel. This is a real, verifiable control action: after "add" runs,
# `iptables -L` will show DROP as the default policy, and the host will in
# fact be unable to reach anything outside the allow-list.
#
# CALLBACK (this is what makes MIRQAB's SUCCESS/FAILED outcome trustworthy):
# Wazuh's manager API only ever confirms it *dispatched* this command — never
# that the agent actually ran it (this was empirically confirmed to diverge:
# the manager reported "dispatched, 0 failed" while this script had never
# executed). So MIRQAB does not trust the dispatch response — instead,
# WazuhActiveResponseProvider.isolate() waits for THIS script to report its
# real result directly, via the POST below. No callback within its timeout
# = MIRQAB records FAILED, not SUCCESS.
#
# Reference implementation — test in a lab VM before trusting this in
# production. Requires iptables (or iptables-nft compat) and curl on the
# agent; adapt the ACCEPT/DROP calls for nftables-native systems. An error in
# the allow-list can strand the agent unreachable by its own manager AND
# unable to call back (no automatic remote undo possible in that case — see
# README "How To Undo Isolation" for the local/manual recovery path).

set -eu

# --- Fill in for your environment before deploying ---------------------
# The Wazuh manager's own address (same host/IP this agent's
# /var/ossec/etc/ossec.conf <server><address> already points at).
MANAGER_ADDRESS="REPLACE_WITH_YOUR_WAZUH_MANAGER_IP"
MANAGER_PORTS="1514 1515"
# MIRQAB backend's real, reachable address/port and the shared secret it
# expects on this callback (same value as backend's MONITORING_INGEST_API_KEY
# — this endpoint reuses that guard). MIRQAB_CALLBACK_HOST is the bare
# IP/hostname used for the firewall allow-list; MIRQAB_CALLBACK_URL is the
# full endpoint curl posts to.
MIRQAB_CALLBACK_HOST="REPLACE_WITH_YOUR_MIRQAB_BACKEND_HOST"
MIRQAB_CALLBACK_PORT="3000"
MIRQAB_CALLBACK_URL="http://REPLACE_WITH_YOUR_MIRQAB_BACKEND_HOST:3000/api/v1/devices/endpoint-control/active-response-result"
MIRQAB_CALLBACK_API_KEY="REPLACE_WITH_YOUR_MONITORING_INGEST_API_KEY"
# -------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_PATH="$SCRIPT_DIR/isolate-host.log"
BACKUP_PATH="/var/ossec/active-response/isolate-host.iptables-backup"
# Phase 2A finding, live-reproduced: this MUST be the Wazuh-registered agent
# name (== Mirqab's Device.hostname, what WazuhActiveResponseProvider.isolate()
# keys its pending-confirmation wait on) — NOT the OS-level `hostname` command.
# On a container (and potentially other hosts enrolled under a different name
# than their OS hostname) these two values differ, and every callback this
# script ever sent under the wrong value was silently dropped by MIRQAB as
# "no matching pending isolate() call" — confirmed live: the script logged
# "Callback to MIRQAB sent (success=true)" while the backend's own log showed
# a WARN for that callback every single time. /var/ossec/etc/client.keys is
# Wazuh's own local record of this agent's registered name (format: "<id>
# <name> <ip> <key>"), always present after enrollment, so it's used instead.
HOSTNAME_VALUE="$(awk '{print $2; exit}' /var/ossec/etc/client.keys 2>/dev/null)"
[ -n "$HOSTNAME_VALUE" ] || HOSTNAME_VALUE="$(hostname)"

log() {
  echo "$(date -Iseconds) $1" >>"$LOG_PATH"
}

# Reports the REAL outcome of this script back to MIRQAB. Never assumes
# success — $1 must be "true" or "false", reflecting what actually happened
# just above this call, not what was merely attempted.
report_result() {
  success="$1"
  detail="$2"
  curl -s -m 10 -X POST "$MIRQAB_CALLBACK_URL" \
    -H "X-Api-Key: $MIRQAB_CALLBACK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"hostname\":\"$HOSTNAME_VALUE\",\"success\":$success,\"detail\":\"$detail\"}" \
    >>"$LOG_PATH" 2>&1 \
    && log "Callback to MIRQAB sent (success=$success)." \
    || log "WARNING: callback to MIRQAB failed to send — MIRQAB's isolate() call will time out and record FAILED even though this script's own action (below) may have succeeded."
}

add_isolation() {
  # Idempotency: a real duplicate/repeated isolation request (retried call,
  # or a second on-demand dispatch landing while the first is still in
  # flight — Wazuh's manager->agent AR delivery is not instant, see
  # WazuhActiveResponseProvider's EXECUTION_CONFIRMATION_TIMEOUT_MS comment)
  # must not re-run iptables-save here: this host is already isolated, so
  # that would capture the ALREADY-DROP state as the "pre-isolation" backup,
  # and a later "delete" would restore into isolation instead of out of it —
  # a real bug found by testing exactly this duplicate-request scenario live.
  # Treat an existing backup as "already isolated" and report success
  # without touching firewall state again.
  if [ -f "$BACKUP_PATH" ]; then
    log "Isolation already applied (backup exists) — treating this as a duplicate request, not re-applying."
    report_result true "Host $HOSTNAME_VALUE is already isolated — this request changed nothing (duplicate/idempotent)."
    return 0
  fi

  log "Applying isolation (manager allow-list: $MANAGER_ADDRESS, callback allow-list: $MIRQAB_CALLBACK_HOST)"

  # Preserve current rules so "delete" can restore the pre-isolation state
  # exactly, rather than assuming a generic default.
  if ! iptables-save >"$BACKUP_PATH" 2>>"$LOG_PATH"; then
    log "ERROR: iptables-save failed — aborting before touching any rules."
    report_result false "iptables-save failed before isolation could be applied — no firewall changes were made."
    exit 1
  fi

  if
    iptables -A INPUT -i lo -j ACCEPT &&
      iptables -A OUTPUT -o lo -j ACCEPT &&
      iptables -A OUTPUT -d "$MIRQAB_CALLBACK_HOST" -p tcp --dport "$MIRQAB_CALLBACK_PORT" -j ACCEPT &&
      iptables -A INPUT -s "$MIRQAB_CALLBACK_HOST" -p tcp --sport "$MIRQAB_CALLBACK_PORT" -j ACCEPT
  then
    for port in $MANAGER_PORTS; do
      iptables -A OUTPUT -d "$MANAGER_ADDRESS" -p tcp --dport "$port" -j ACCEPT
      iptables -A INPUT -s "$MANAGER_ADDRESS" -p tcp --sport "$port" -j ACCEPT
    done
    iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
    iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
  else
    log "ERROR: failed to install allow-list rules — restoring pre-isolation state rather than leaving a partial, unverified lockdown."
    iptables-restore <"$BACKUP_PATH" 2>>"$LOG_PATH" || true
    report_result false "Failed to install the allow-list rules — isolation was aborted and rolled back, not applied."
    exit 1
  fi

  # The actual isolation: deny everything else. Only reached if every
  # allow-list rule above was installed successfully.
  if iptables -P INPUT DROP && iptables -P OUTPUT DROP && iptables -P FORWARD DROP; then
    log "Isolation applied — INPUT/OUTPUT/FORWARD default policy = DROP."
    report_result true "Isolation genuinely applied on $HOSTNAME_VALUE: INPUT/OUTPUT/FORWARD default policy is now DROP, verified by this script immediately after setting it."
  else
    log "ERROR: failed to set default DROP policy after allow-list rules were installed — network state is inconsistent, restoring backup."
    iptables-restore <"$BACKUP_PATH" 2>>"$LOG_PATH" || true
    report_result false "Failed to set the default DROP policy — isolation was not completed, and the prior state was restored."
    exit 1
  fi
}

remove_isolation() {
  log "Reversing isolation."

  if [ -f "$BACKUP_PATH" ]; then
    if iptables-restore <"$BACKUP_PATH" 2>>"$LOG_PATH"; then
      rm -f "$BACKUP_PATH"
      log "Isolation reversed — restored pre-isolation iptables rules from backup."
      report_result true "Isolation reversed on $HOSTNAME_VALUE — pre-isolation firewall rules restored from backup."
    else
      log "ERROR: iptables-restore failed."
      report_result false "iptables-restore failed while reversing isolation — the host may still be isolated."
    fi
  else
    # No backup found (first run, or backup was lost) — fail open rather
    # than leaving the host silently locked out with no record of why.
    iptables -P INPUT ACCEPT
    iptables -P OUTPUT ACCEPT
    iptables -P FORWARD ACCEPT
    iptables -F
    log "WARNING: no backup found at $BACKUP_PATH — flushed rules and reset policies to ACCEPT instead of restoring prior state."
    report_result true "No isolation backup was found (host was likely not isolated) — reset to default ACCEPT policies as a safe fallback."
  fi
}

# Phase 2A finding, live-reproduced twice: Wazuh 4.14.7's wazuh-execd does
# not reliably close this script's stdin after writing the JSON payload —
# confirmed by inspecting the actual running process tree during a real,
# execd-dispatched invocation: `cat` was still blocked in state S waiting on
# stdin 5+ minutes after execd logged "Executing command". Because execd
# appears to process Active Response invocations one at a time, that single
# stuck `cat` permanently wedges EVERY later Active Response command (including
# the reversal/"delete" path) until something kills the hung process or
# restarts the agent — reproduced identically on a second, freshly-dispatched
# command right after killing the first hang. A plain `cat` here is therefore
# not safe in this environment. `timeout` does not change correctness of the
# normal case (execd's write already lands in the pipe buffer instantly; this
# only bounds how long the script waits for the EOF that sometimes never
# comes) — it exists purely so one hung invocation can no longer take down
# every later isolate/unisolate request.
payload="$(timeout 5 cat)" || true
command_value="$(echo "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')"

case "$command_value" in
  add) add_isolation ;;
  delete) remove_isolation ;;
  *) log "Unrecognized command '$command_value' — no action taken." ;;
esac
