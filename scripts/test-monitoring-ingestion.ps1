<#
.SYNOPSIS
  Sends realistic Wazuh/Suricata/Sysmon payloads to the live backend's
  /monitoring/* endpoints (backend/src/modules/monitoring), then confirms
  real incidents were created via GET /ai/incidents. This is the first time
  these endpoints have been hit with real HTTP requests through the running
  backend - Phase 8's tests only exercised MonitoringService with a mocked
  AiService.

.DESCRIPTION
  Resolves the backend's Docker-published port and the shared monitoring
  API key from infra/docker/.env. Uses one registered seed device
  (FIN-WKS-01, IT-SRV-01) per ingestion call and one unregistered hostname
  to also exercise the "no device match, ingest anyway" fallback path.
#>

$ProgressPreference = 'SilentlyContinue'
$composeDir = Join-Path $PSScriptRoot '..\infra\docker'

Push-Location $composeDir
try {
    $portMapping = docker compose port backend 3000
    $envLines = Get-Content '.env'
} finally {
    Pop-Location
}

if (-not $portMapping) {
    Write-Output 'FAILED: could not resolve the backend published port.'
    exit 1
}
$hostPort = ($portMapping -split ':')[-1]

$apiKeyLine = $envLines | Where-Object { $_ -like 'MONITORING_INGEST_API_KEY=*' }
$apiKey = $apiKeyLine -replace 'MONITORING_INGEST_API_KEY=', ''

$adminEmailLine = $envLines | Where-Object { $_ -like 'ADMIN_EMAIL=*' }
$adminEmail = $adminEmailLine -replace 'ADMIN_EMAIL=', ''
$adminPasswordLine = $envLines | Where-Object { $_ -like 'ADMIN_PASSWORD=*' }
$adminPassword = $adminPasswordLine -replace 'ADMIN_PASSWORD=', ''

$base = "http://localhost:$hostPort/api/v1"
Write-Output "Backend at $base"

function Post-Ingest($path, $payload) {
    $json = $payload | ConvertTo-Json -Depth 5
    $params = @{
        Uri         = "$base/monitoring/$path"
        Method      = 'Post'
        Body        = $json
        ContentType = 'application/json'
        Headers     = @{ 'X-Api-Key' = $apiKey }
    }
    try {
        $resp = Invoke-WebRequest @params -UseBasicParsing
        $incident = ($resp.Content | ConvertFrom-Json).incident
        Write-Output "$path -> status $($resp.StatusCode), incident $($incident.id), severity $($incident.severity), technique $($incident.mitreTechniqueId)"
    } catch {
        Write-Output "$path -> FAILED: $($_.Exception.Message)"
    }
}

Write-Output ''
Write-Output '--- Wazuh (registered device FIN-WKS-01) ---'
Post-Ingest 'wazuh' @{
    rule     = @{ id = '5710'; level = 10; description = 'Multiple authentication failures' }
    agent    = @{ name = 'FIN-WKS-01'; id = '001' }
    full_log = 'sshd: Failed password for invalid user admin from 203.0.113.9 port 51514 ssh2'
    location = '/var/log/auth.log'
}

Write-Output ''
Write-Output '--- Suricata (registered device IT-SRV-01) ---'
Post-Ingest 'suricata' @{
    host       = 'IT-SRV-01'
    event_type = 'alert'
    src_ip     = '10.10.3.10'
    dest_ip    = '198.51.100.23'
    proto      = 'TCP'
    alert      = @{ signature = 'ET SCAN Nmap Scripting Engine User-Agent Detected'; category = 'Attempted Information Leak'; severity = 2 }
}

Write-Output ''
Write-Output '--- Sysmon (unregistered hostname, exercises the no-device fallback) ---'
Post-Ingest 'sysmon' @{
    Computer    = 'GHOST-HOST-01'
    EventID     = 1
    Image       = 'C:\Windows\System32\cmd.exe'
    CommandLine = 'cmd.exe /c whoami /all'
    User        = 'CORP\svc-unknown'
    ParentImage = 'C:\Windows\explorer.exe'
}

Write-Output ''
Write-Output '--- Confirming via GET /ai/incidents (as admin) ---'
$loginBody = @{ email = $adminEmail; password = $adminPassword } | ConvertTo-Json
try {
    $loginResp = Invoke-WebRequest -Uri "$base/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -UseBasicParsing
    $token = ($loginResp.Content | ConvertFrom-Json).accessToken
    $incidentsResp = Invoke-WebRequest -Uri "$base/ai/incidents" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
    $incidents = $incidentsResp.Content | ConvertFrom-Json
    $recent = $incidents | Select-Object -First 3
    foreach ($inc in $recent) {
        Write-Output "  $($inc.createdAt)  $($inc.mitreTechniqueId)  $($inc.severity)  deviceId=$($inc.deviceId)"
    }
} catch {
    Write-Output "FAILED to confirm via GET /ai/incidents: $($_.Exception.Message)"
}
