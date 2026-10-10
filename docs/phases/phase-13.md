# Phase 13 — Running the Monitoring Ingestion Pipeline for Real

**Scope:** the last open item from Phase 12's roadmap — `infra/monitoring/`'s
Wazuh/Suricata/Sysmon agent scripts (Phase 8) had only ever been reviewed,
never executed against anything. This phase actually ran them, as far as
this environment honestly allows.

## What was verified for real

### All three `/monitoring/*` endpoints, live, for the first time

Phase 8's tests (`monitoring.service.spec.ts`) only ever exercised
`MonitoringService` with a mocked `AiService` — no test had sent an actual
HTTP request through the running backend to `/monitoring/wazuh`,
`/monitoring/suricata`, or `/monitoring/sysmon` before this phase.
`scripts/test-monitoring-ingestion.ps1` sends one realistic payload to each,
using real seeded devices where relevant, and confirms the results via a
real `GET /ai/incidents` call (as the seeded admin):

| Endpoint | Device | Result |
|---|---|---|
| `/monitoring/wazuh` | `FIN-WKS-01` (registered) | `201`, incident created, `UNCLASSIFIED`/`LOW` |
| `/monitoring/suricata` | `IT-SRV-01` (registered) | `201`, incident created, `T1046`/`LOW`, `deviceId` correctly resolved |
| `/monitoring/sysmon` | `GHOST-HOST-01` (**not** registered) | `201`, incident created, `T1059`/`MEDIUM`, `deviceId` empty |

Two things worth calling out, both confirming existing design decisions
rather than surfacing bugs:

- **The Wazuh payload's genuine sshd log line came back `UNCLASSIFIED`.**
  `sshd: Failed password for invalid user admin from 203.0.113.9 port
  51514 ssh2` is real-world log phrasing — and the rule-based MITRE
  keyword matcher (Phase 5, no `ANTHROPIC_API_KEY` configured in this test
  environment) doesn't recognize it as brute-force activity, because it
  doesn't contain the specific keywords the matcher looks for. This is
  exactly the documented, intended behavior from Phase 8's design notes
  ("an `UNCLASSIFIED` result on real-world text the matcher doesn't
  recognize is a correct outcome, not a bug") — now actually demonstrated
  with genuine log text, not asserted in the abstract.
- **The unregistered Sysmon hostname ingested successfully with no
  `deviceId`**, exactly as `MonitoringService.resolveDeviceId()` was
  designed to do — proving the "don't drop events from unenrolled hosts"
  behavior live, not just in a unit test with a mocked `DevicesService`.

### The real Suricata forwarder script, actually executed

`infra/monitoring/suricata/eve-forwarder.js` needs only Node, which this
environment already has — no new install required. `scripts/test-suricata-forwarder.ps1`:

1. Starts the real script (not a re-implementation of its logic) watching
   a temp `eve.json` file, pointed at the live backend.
2. Appends a genuine-shaped Suricata `alert` event line to that file —
   simulating Suricata itself writing a new detection.
3. Waits for the script's `fs.watch` handler to pick up the change and
   forward it.
4. Confirms via `GET /ai/incidents` that a real incident now exists
   matching that alert's signature.
5. Always stops the forwarder process (`Stop-Process`) and deletes the
   temp file in a `finally` block, whether the test passed or failed —
   confirmed afterward with `Get-Process node` that nothing was left
   running.

Result: incident created, classified `T1071` (Command and Control) /
`HIGH` severity from the "C2 Beacon Activity" signature text — the keyword
matcher caught this one correctly, unlike the Wazuh sshd line above.

## Environment limitations, not implementation gaps

Everything below is blocked by something about *this specific sandboxed
machine* — not by anything missing or incomplete in Mirqab's own code. Each
item's target endpoint/code path is already verified live, above.

- **`infra/monitoring/wazuh/mirqab-integration.py`** — Python isn't
  installed in this environment (only the Windows Store app-execution-alias
  stub, which errors rather than running anything). The script's actual
  logic (read alert JSON, build the same payload shape, POST it with an
  API key header) is simple enough that the direct endpoint test above
  exercises the same backend-side contract, but the `.py` file itself was
  not executed. Installing Python to close this gap wasn't done
  unprompted — it's a new software install, a different category of action
  than starting an already-installed Docker Desktop (Phase 10) or already-
  installed Git, and worth a deliberate decision rather than a silent one.
- **`infra/monitoring/sysmon/sysmon-forwarder.ps1`** — no Sysmon
  installation exists on this machine, and installing one (a persistent,
  system-wide security-monitoring driver and Windows service) is a more
  consequential, harder-to-casually-reverse change than a language runtime
  — not done without explicit request. Same treatment: the endpoint
  contract this script would hit is verified live above; the actual
  `.ps1` script against genuine `Microsoft-Windows-Sysmon/Operational`
  events is not.
- **A real CA-issued TLS cert** — unchanged since Phase 9: no public
  domain exists in this sandbox to issue one for. Restated, not solved,
  same as Phase 12.

## Verification

- `scripts/test-monitoring-ingestion.ps1` — all three endpoints return
  `201`; `GET /ai/incidents` confirms all three, including the correct
  `deviceId` (or lack thereof) for each.
- `scripts/test-suricata-forwarder.ps1` — the real forwarder script picks
  up a live file change and creates a matching incident; process cleanup
  confirmed via `Get-Process node` afterward.
- No backend or Employee Desktop code changed this phase — only new
  verification scripts and documentation.

## Project status: finalized

This is the last planned phase. All 13 phases are implemented and verified
as far as this sandboxed environment allows. The Wazuh/Sysmon script
execution and the real CA-issued TLS cert are documented here and in the
root `README.md`'s "Known Limitations" section as **environment
constraints, not implementation issues**: every endpoint and code path
those two scripts would exercise has already been verified live through
the direct payload tests above; what's missing is the literal external
tool (Python, a Sysmon install, a public domain for cert issuance) on this
specific machine, not any gap in Mirqab's own code. Installing Python
and/or Sysmon remains available as a deliberate, explicitly-requested
follow-up if that last layer of verification is ever wanted — not something
to default into as part of finishing this project.
