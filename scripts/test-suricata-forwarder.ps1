<#
.SYNOPSIS
  Actually runs infra/monitoring/suricata/eve-forwarder.js (the real shipped
  script, not a re-implementation of its contract) against a live, growing
  eve.json file, pointed at the live backend, and confirms a real incident
  gets created from it.

.DESCRIPTION
  Node is already available in this environment, so this runs the real
  artifact end-to-end: starts the forwarder watching a temp eve.json,
  appends a genuine-shaped Suricata alert line to that file (simulating
  Suricata itself writing a new alert), waits for the fs.watch-triggered
  forward, then checks GET /ai/incidents for a match. Always stops the
  forwarder process before exiting, even on failure.
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

$hostPort = ($portMapping -split ':')[-1]
$apiKeyLine = $envLines | Where-Object { $_ -like 'MONITORING_INGEST_API_KEY=*' }
$apiKey = $apiKeyLine -replace 'MONITORING_INGEST_API_KEY=', ''
$adminEmail = ($envLines | Where-Object { $_ -like 'ADMIN_EMAIL=*' }) -replace 'ADMIN_EMAIL=', ''
$adminPassword = ($envLines | Where-Object { $_ -like 'ADMIN_PASSWORD=*' }) -replace 'ADMIN_PASSWORD=', ''

$base = "http://localhost:$hostPort/api/v1"
$eveFile = Join-Path $env:TEMP 'mirqab-test-eve.json'
Set-Content -Path $eveFile -Value '' -Encoding utf8

$env:EVE_JSON_PATH = $eveFile
$env:MIRQAB_INGEST_URL = "$base/monitoring/suricata"
$env:MONITORING_INGEST_API_KEY = $apiKey
$env:SENSOR_HOSTNAME = 'ENG-SRV-01'

$forwarderScript = Join-Path $PSScriptRoot '..\infra\monitoring\suricata\eve-forwarder.js'
$process = Start-Process -FilePath 'node' -ArgumentList "`"$forwarderScript`"" -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:TEMP 'mirqab-eve-forwarder.out.log') -RedirectStandardError (Join-Path $env:TEMP 'mirqab-eve-forwarder.err.log')

try {
    Start-Sleep -Seconds 2

    $alertLine = @{
        timestamp  = '2026-07-27T16:00:00.000000+0000'
        event_type = 'alert'
        src_ip     = '10.10.5.10'
        dest_ip    = '198.51.100.77'
        proto      = 'TCP'
        alert      = @{ signature = 'ET MALWARE Possible C2 Beacon Activity'; category = 'A Network Trojan was detected'; severity = 1 }
    } | ConvertTo-Json -Compress

    Add-Content -Path $eveFile -Value $alertLine

    Start-Sleep -Seconds 3

    $loginBody = @{ email = $adminEmail; password = $adminPassword } | ConvertTo-Json
    $loginResp = Invoke-WebRequest -Uri "$base/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -UseBasicParsing
    $token = ($loginResp.Content | ConvertFrom-Json).accessToken
    $incidentsResp = Invoke-WebRequest -Uri "$base/ai/incidents" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
    $incidents = $incidentsResp.Content | ConvertFrom-Json
    $match = $incidents | Where-Object { $_.sourceExcerpt -like '*C2 Beacon*' } | Select-Object -First 1

    if ($match) {
        Write-Output "SUCCESS: real-time forwarder created incident $($match.id), technique $($match.mitreTechniqueId), severity $($match.severity)"
    } else {
        Write-Output 'FAILED: no matching incident found after running the real forwarder script.'
        Write-Output '--- forwarder stdout ---'
        Get-Content (Join-Path $env:TEMP 'mirqab-eve-forwarder.out.log') -ErrorAction SilentlyContinue
        Write-Output '--- forwarder stderr ---'
        Get-Content (Join-Path $env:TEMP 'mirqab-eve-forwarder.err.log') -ErrorAction SilentlyContinue
    }
} finally {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Remove-Item $eveFile -Force -ErrorAction SilentlyContinue
}
