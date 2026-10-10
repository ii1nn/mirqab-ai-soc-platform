# Integration Phase 1 — Wazuh Sample Log Ingestion

**Scope:** get the `datasets/wazuh-sample-logs` sample data flowing through Mirqab end-to-end (parsed,
normalized, stored, exposed via API, visible on the dashboard) without standing up a real Wazuh manager or
duplicating any of the existing AI triage pipeline.

## Why this needed new code at all

`backend/src/modules/monitoring` already has a complete `/monitoring/wazuh` ingestion path
(`MonitoringController` → `MonitoringService.ingestWazuh()` → `AiService.analyzeLog()`), built in the
original project phases. It expects an **already-decoded Wazuh alert** shape (`rule.{id,level,description}`,
`agent.name`, `full_log`) — exactly what a live Wazuh manager's integration script would POST.

The sample data pulled into `datasets/wazuh-sample-logs/` is the opposite end of that pipeline: **raw**
source logs (Kubernetes/Azure events, AWS CloudTrail JSON, Fortigate key=value firewall/VPN logs) that a
real Wazuh manager would decode and rule-match *before* producing an alert. There was nothing in the
codebase that turned one into the other. That's the one gap this phase fills — everything downstream
(classification, MITRE mapping, ticketing, notifications, dashboard display) already existed and needed no
changes.

## What was added

All new code lives under `backend/src/modules/monitoring/wazuh-samples/` — a submodule of the existing
`MonitoringModule`, not a new top-level module:

- **`wazuh-sample-log.parser.ts`** — `parseWazuhSampleLine(raw: string): WazuhAlertDto | null`. Detects the
  raw line's shape (JSON starting with `{`, or Fortigate `date=...` key=value) and produces the same
  `{ rule, agent, full_log, location }` shape a real Wazuh decode/rule-match would. This is intentionally a
  lightweight stand-in for these specific sample formats — Integration Phase 3's Wazuh Logtest client is
  the real decode/rule-match path for arbitrary input.
  - Kubernetes events: `Warning` → rule level 8, else 3.
  - AWS CloudTrail: a small set of sensitive IAM/EC2 event names (`CreateUser`, `AddUserToGroup`,
    `StopInstances`, etc.) → level 9, everything else (e.g. read-only `ListUsers`) → level 3.
  - Fortigate: its own `level="..."` field (`error`, `warning`, `information`, ...) mapped to a Wazuh-style
    0–15 scale.
- **`wazuh-samples.data.ts`** — 9 real lines copied verbatim from the fetched sample files (3 Kubernetes
  warnings, 3 AWS CloudTrail events of varying sensitivity, 3 Fortigate log lines) — see
  `datasets/wazuh-sample-logs/NOTES.md` for provenance.
- **`wazuh-samples.service.ts`** — `WazuhSamplesService.seed()` parses each bundled line and calls the
  existing `MonitoringService.ingestWazuh()` for each one, unchanged. No new Prisma models, no new
  classification logic.
- **`wazuh-samples.controller.ts`** — `POST /monitoring/wazuh-samples/seed`. Unlike `MonitoringController`
  (which is `@Public()` + API-key-gated for headless forwarders), this requires normal analyst auth
  (`@Roles(ADMIN, SECURITY_ANALYST)`, global `JwtAuthGuard` applies) since it's a dashboard-triggered demo
  action, not something an external agent calls.

### Dashboard

- **`apps/soc-dashboard/src/services/monitoring.service.ts`** — new, minimal: one function,
  `seedWazuhSamples()`, calling the endpoint above.
- **`apps/soc-dashboard/src/features/settings/SettingsPage.tsx`** — added a "Wazuh Sample Data" card next
  to the existing Simulation Mode card, with a "Load Wazuh sample data" button and a result/error state.
  Chosen because it's the same pattern Simulation Mode already established (a manually-triggered demo data
  source living in Settings) — no new page or navigation entry needed.

### No new database tables, no new top-level API surface

Ingested samples become ordinary `Incident` rows via the existing `AiService.analyzeLog()` — same table,
same classification (Claude or rule-based fallback), same auto-ticketing for HIGH/CRITICAL severity, same
`REALTIME_EVENTS.INCIDENT_CREATED` websocket emission. They show up on the existing Live Alerts page,
Dashboard widgets, and Incident History exactly like any other incident — no dashboard display code needed
beyond the trigger button.

## How to try it

1. Log in to the SOC Dashboard as an analyst.
2. Settings → "Wazuh Sample Data" card → **Load Wazuh sample data**.
3. Watch Live Alerts / Dashboard — up to 9 new incidents appear (fewer if a line fails to parse), with
   severities/MITRE mappings assigned by the existing AI triage pipeline exactly as if a live Wazuh manager
   had sent them.

## Verification

- `npm run build` passes in `backend/` and `apps/soc-dashboard/`.
- Backend, SOC Dashboard, and Employee Desktop all start successfully (see repo-root verification log for
  this pass).
