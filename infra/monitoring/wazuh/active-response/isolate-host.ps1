#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Wazuh custom Active Response script — real Windows network isolation.

.DESCRIPTION
  Install as:
    C:\Program Files (x86)\ossec-agent\active-response\bin\isolate-host.ps1
  on the WINDOWS AGENT you want isolatable (not the manager). Register it on
  the MANAGER's ossec.conf with the <command>/<active-response> blocks in
  ossec-active-response-snippet.xml in this folder — the <name> you choose
  there is what you set as WAZUH_ISOLATION_AR_COMMAND in backend/.env.

  Protocol (verified against
  https://documentation.wazuh.com/current/user-manual/capabilities/active-response/custom-active-response-scripts.html
  at implementation time — reconfirm against your installed version): the
  Wazuh agent invokes this script and writes one JSON line to STDIN:
    {"version":1,"origin":{...},"command":"add"|"delete","parameters":{...}}
  "add" = apply isolation now. "delete" = the manager's <active-response>
  <timeout> for this command has elapsed — automatically reverse it. This is
  the primary, documented auto-revert mechanism — configure a real <timeout>
  in ossec-active-response-snippet.xml so a stuck isolation can't outlive it.

  MECHANISM (this is what actually blocks network access — not a status
  flag): sets Windows Firewall to Block as the default inbound AND outbound
  action on all profiles, then adds narrow allow-rules for loopback and for
  this agent's Wazuh manager (so the agent stays reachable and can still
  receive the "delete" command later). Everything else — the malware's C2
  channel included — is dropped at the OS firewall. This is a real,
  verifiable control action: after "add" runs, `Get-NetFirewallProfile` will
  show DefaultInboundAction/DefaultOutboundAction = Block, and the host will
  in fact be unable to reach anything outside the allow-list.

.NOTES
  Reference implementation — test in a lab VM before trusting this in
  production. An error in the allow-list can strand the agent unreachable by
  its own manager (no automatic remote undo possible in that case — see
  README "How To Undo Isolation" for the local/manual recovery path).
#>

# --- Fill in for your environment before deploying ---------------------
# The Wazuh manager's own address (same host/IP your agent's ossec.conf
# <server><address> already points at) and its default agent ports. Traffic
# to/from this stays allowed specifically so the agent can still receive the
# later "delete" (un-isolate) command.
$ManagerAddress = 'REPLACE_WITH_YOUR_WAZUH_MANAGER_IP'
$ManagerPorts = @(1514, 1515)
# -------------------------------------------------------------------------

$LogPath = Join-Path $PSScriptRoot 'isolate-host.log'
$RuleNamePrefix = 'MIRQAB-Isolation'

function Write-Log {
    param([string]$Message)
    $line = "$(Get-Date -Format o) $Message"
    Add-Content -Path $LogPath -Value $line
}

function Add-Isolation {
    Write-Log "Applying isolation (manager allow-list: $ManagerAddress)"

    # Remove any stale rules from a previous run first, so re-running "add"
    # is idempotent rather than stacking duplicate rules.
    Get-NetFirewallRule -DisplayName "$RuleNamePrefix*" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue

    # Narrow allow-list, evaluated before the default-block policy below.
    New-NetFirewallRule -DisplayName "$RuleNamePrefix-Loopback" -Direction Inbound `
        -Action Allow -LocalAddress 127.0.0.1 -RemoteAddress 127.0.0.1 | Out-Null
    foreach ($port in $ManagerPorts) {
        New-NetFirewallRule -DisplayName "$RuleNamePrefix-Manager-Out-$port" -Direction Outbound `
            -Action Allow -RemoteAddress $ManagerAddress -RemotePort $port -Protocol TCP | Out-Null
        New-NetFirewallRule -DisplayName "$RuleNamePrefix-Manager-In-$port" -Direction Inbound `
            -Action Allow -RemoteAddress $ManagerAddress -LocalPort $port -Protocol TCP | Out-Null
    }

    # The actual isolation: deny everything else by default, on every profile.
    Set-NetFirewallProfile -Profile Domain, Public, Private `
        -DefaultInboundAction Block -DefaultOutboundAction Block

    Write-Log 'Isolation applied — DefaultInboundAction/DefaultOutboundAction = Block on all profiles.'
}

function Remove-Isolation {
    Write-Log 'Reversing isolation.'

    # Windows Firewall's documented, safe default (matches a clean install).
    Set-NetFirewallProfile -Profile Domain, Public, Private `
        -DefaultInboundAction Block -DefaultOutboundAction Allow

    Get-NetFirewallRule -DisplayName "$RuleNamePrefix*" -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue

    Write-Log 'Isolation reversed — DefaultOutboundAction restored to Allow, allow-list rules removed.'
}

try {
    $raw = [Console]::In.ReadToEnd()
    $payload = $raw | ConvertFrom-Json

    switch ($payload.command) {
        'add' { Add-Isolation }
        'delete' { Remove-Isolation }
        default { Write-Log "Unrecognized command '$($payload.command)' — no action taken." }
    }
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
