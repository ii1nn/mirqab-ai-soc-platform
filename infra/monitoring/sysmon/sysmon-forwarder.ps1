<#
.SYNOPSIS
  Polls the local Sysmon operational log and forwards new events to Mirqab's
  POST /monitoring/sysmon ingestion endpoint (see
  backend/src/modules/monitoring/dto/sysmon-event.dto.ts).

.DESCRIPTION
  Reference implementation for a single endpoint without Winlogbeat/Logstash
  in the pipeline. Run on the endpoint itself (or centrally against a
  Windows Event Forwarding collector) as a Scheduled Task, e.g. every minute.
  Only forwards the event IDs Mirqab's classifier actually uses — see
  backend/src/modules/monitoring/sysmon-event-names.data.ts.

.PARAMETER IngestUrl
  e.g. http://backend:3000/api/v1/monitoring/sysmon

.PARAMETER ApiKey
  The MONITORING_INGEST_API_KEY configured on the backend.
#>
param(
    [Parameter(Mandatory = $true)][string]$IngestUrl,
    [Parameter(Mandatory = $true)][string]$ApiKey,
    [string]$StateFile = "$env:ProgramData\Mirqab\sysmon-forwarder.state"
)

$RelevantEventIds = 1, 3, 7, 8, 10, 11, 12, 13, 22

New-Item -ItemType Directory -Force -Path (Split-Path $StateFile) | Out-Null
$lastRecordId = if (Test-Path $StateFile) { [int64](Get-Content $StateFile) } else { 0 }

$events = Get-WinEvent -FilterHashtable @{
    LogName = 'Microsoft-Windows-Sysmon/Operational'
    Id      = $RelevantEventIds
} -ErrorAction SilentlyContinue |
    Where-Object { $_.RecordId -gt $lastRecordId } |
    Sort-Object RecordId

foreach ($event in $events) {
    $xml = [xml]$event.ToXml()
    $data = @{}
    foreach ($field in $xml.Event.EventData.Data) {
        $data[$field.Name] = $field.'#text'
    }

    $body = @{
        Computer          = $env:COMPUTERNAME
        EventID           = $event.Id
        Image             = $data['Image']
        CommandLine       = $data['CommandLine']
        User              = $data['User']
        ParentImage       = $data['ParentImage']
        TargetFilename    = $data['TargetFilename']
        DestinationIp     = $data['DestinationIp']
        DestinationPort   = if ($data['DestinationPort']) { [int]$data['DestinationPort'] } else { $null }
    } | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Uri $IngestUrl -Method Post -Body $body `
            -ContentType 'application/json' -Headers @{ 'X-Api-Key' = $ApiKey }
    } catch {
        Write-Warning "Failed to forward Sysmon event $($event.RecordId): $_"
        continue
    }

    Set-Content -Path $StateFile -Value $event.RecordId
}
