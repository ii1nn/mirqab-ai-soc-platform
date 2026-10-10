# Sysmon → Mirqab

`sysmon-forwarder.ps1` polls the local `Microsoft-Windows-Sysmon/Operational`
event log and forwards new events to Mirqab's `POST /monitoring/sysmon` (see
`backend/src/modules/monitoring`).

## Run

Requires Sysmon already installed and logging (see
[Sysinternals Sysmon](https://learn.microsoft.com/sysinternals/downloads/sysmon)).
Register as a Scheduled Task on each endpoint, running every 1–5 minutes:

```powershell
schtasks /Create /TN "Mirqab Sysmon Forwarder" /SC MINUTE /MO 1 `
  /TR "powershell.exe -ExecutionPolicy Bypass -File C:\Mirqab\sysmon-forwarder.ps1 -IngestUrl http://backend:3000/api/v1/monitoring/sysmon -ApiKey <MONITORING_INGEST_API_KEY>" `
  /RU SYSTEM
```

It tracks the last forwarded `RecordId` in a state file
(`%ProgramData%\Mirqab\sysmon-forwarder.state`) so re-runs only forward new
events. `$env:COMPUTERNAME` is sent as the hostname — it must match a
`Device.hostname` already registered in Mirqab for the event to carry
department context (see `DevicesService.findByHostname`); otherwise it's
still ingested, just without a resolved device.
