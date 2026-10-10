#!/bin/sh
# Companion recovery command for isolate-host.sh — registered on the manager
# as a SEPARATE Active Response command ("mirqab-unisolate" by convention,
# see ossec-active-response-snippet.xml) so an analyst (or MIRQAB) can
# explicitly reverse isolation on demand via
# PUT /active-response?agents_list=<id> {"command":"!mirqab-unisolate"},
# without waiting for isolate-host.sh's own <timeout> auto-revert.
#
# Wazuh always invokes a freshly-triggered command with "command":"add" in
# its stdin payload (there is no documented way to directly invoke another
# command's "delete" branch via the API) — so here, "add" IS "please
# unisolate now". Shares the exact same restore logic, backup file, and
# MIRQAB callback contract as isolate-host.sh — install alongside it at
# /var/ossec/active-response/bin/unisolate-host.sh with the same permissions.

set -eu

# --- Fill in for your environment before deploying (same values as isolate-host.sh) ---
MIRQAB_CALLBACK_URL="http://REPLACE_WITH_YOUR_MIRQAB_BACKEND_HOST:3000/api/v1/devices/endpoint-control/active-response-result"
MIRQAB_CALLBACK_API_KEY="REPLACE_WITH_YOUR_MONITORING_INGEST_API_KEY"
# -----------------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_PATH="$SCRIPT_DIR/isolate-host.log"
BACKUP_PATH="/var/ossec/active-response/isolate-host.iptables-backup"
HOSTNAME_VALUE="$(hostname)"

log() {
  echo "$(date -Iseconds) $1" >>"$LOG_PATH"
}

report_result() {
  success="$1"
  detail="$2"
  curl -s -m 10 -X POST "$MIRQAB_CALLBACK_URL" \
    -H "X-Api-Key: $MIRQAB_CALLBACK_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"hostname\":\"$HOSTNAME_VALUE\",\"success\":$success,\"detail\":\"$detail\"}" \
    >>"$LOG_PATH" 2>&1 \
    && log "Callback to MIRQAB sent (success=$success)." \
    || log "WARNING: callback to MIRQAB failed to send."
}

remove_isolation() {
  log "Reversing isolation (triggered via mirqab-unisolate)."
  if [ -f "$BACKUP_PATH" ]; then
    if iptables-restore <"$BACKUP_PATH" 2>>"$LOG_PATH"; then
      rm -f "$BACKUP_PATH"
      log "Isolation reversed — restored pre-isolation iptables rules from backup."
      report_result true "Isolation reversed on $HOSTNAME_VALUE via mirqab-unisolate — pre-isolation firewall rules restored."
    else
      log "ERROR: iptables-restore failed."
      report_result false "iptables-restore failed while reversing isolation — the host may still be isolated."
    fi
  else
    iptables -P INPUT ACCEPT
    iptables -P OUTPUT ACCEPT
    iptables -P FORWARD ACCEPT
    iptables -F
    log "WARNING: no backup found at $BACKUP_PATH — flushed rules and reset policies to ACCEPT instead (host was likely not isolated)."
    report_result true "No isolation backup was found — reset to default ACCEPT policies as a safe fallback."
  fi
}

payload="$(cat)"
command_value="$(echo "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p')"

case "$command_value" in
  add) remove_isolation ;;
  *) log "mirqab-unisolate invoked with command='$command_value' — no action taken." ;;
esac
