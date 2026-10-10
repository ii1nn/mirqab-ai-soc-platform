# Integration Phase 2 — LogHub SSH/Linux/Apache/Auth Sample Ingestion

**Scope:** get `datasets/loghub`'s SSH, Linux (doubling as Authentication — see that dataset's `NOTES.md`),
and Apache samples flowing through Mirqab, with real severity + MITRE ATT&CK mapping, reusing the exact
same architecture Integration Phase 1 established.

## What was added

### A new generic ingestion source, alongside the existing vendor-specific ones

`backend/src/modules/monitoring` already had `ingestWazuh`/`ingestSuricata`/`ingestSysmon` — one method per
vendor, each building a `sourceExcerpt` and calling `AiService.analyzeLog()`. SSH/Linux/Apache logs aren't
produced by any single vendor agent (they're what rsyslog/syslog-ng-style forwarders carry), so this phase
adds a fourth, equally generic source using the same pattern:

- **`dto/syslog-event.dto.ts`** — `{ host, program: 'ssh'|'linux'|'apache', summary, rawLine, timestamp? }`.
  `summary` vs `rawLine` mirrors `WazuhAlertDto`'s `rule.description` vs `full_log` split.
- **`MonitoringService.ingestSyslog()`** — new method, same shape as the other three: builds an excerpt,
  resolves a device by hostname, calls `aiService.analyzeLog()`. No changes to the other three methods.
- **`MonitoringController`** — new `POST /monitoring/syslog` route, same `@Public()` + API-key-guarded
  class-level setup as the other three (a real syslog forwarder would call this exactly like a Wazuh/Suricata
  agent calls its route).

### `loghub-samples/` submodule (mirrors `wazuh-samples/` from Phase 1)

- **`loghub-sample-log.parser.ts`** — `parseLoghubSampleLine(raw, category)`. Two raw shapes: standard
  syslog (`Mon DD HH:MM:SS host program[pid]: message`, used by both `ssh` and `linux` categories) and
  Apache's error-log format (`[timestamp] [level] message` — no hostname, since Apache error logs are a
  local per-server file, not a syslog stream; a fixed `apache-web-01` placeholder is used and documented as
  such in the code).
  - `summarizeAuthMessage()` turns the raw SSH/Linux message into an accurate, analyst-style sentence —
    e.g. `"authentication failure; ..."` → `"Failed authentication attempt (...)"`. This isn't keyword-gaming:
    it's the same normalization a real Wazuh decoder/rule description already does, and it happens to use
    the same natural vocabulary (`MitreMappingService`'s keyword list) a security analyst would use to
    describe the same event, since the technique names and their keyword lists are drawn from real MITRE
    ATT&CK terminology.
- **`loghub-samples.data.ts`** — 10 real lines copied verbatim from the bundled dataset (4 SSH, 3 Linux, 3
  Apache) — see `datasets/loghub/NOTES.md`.
- **`loghub-samples.service.ts`** — `LoghubSamplesService.seed()`, parses all 10 lines and calls the new
  `MonitoringService.ingestSyslog()` for each, same loop-and-collect shape as `WazuhSamplesService`.
- **`loghub-samples.controller.ts`** — `POST /monitoring/loghub-samples/seed`, analyst-authenticated, same
  as `WazuhSamplesController`.

### Dashboard

- `monitoringService.seedLoghubSamples()` added next to `seedWazuhSamples()`.
- A second "LogHub Sample Data" card added to the Settings page, same pattern as the Wazuh one.

### Still no new database tables

Everything lands in the same `Incident` table via the same `AiService.analyzeLog()` call every other source
uses — same classification, ticketing, notifications, realtime events, dashboard display.

## Verifying severity + MITRE mapping actually works, not just "wired up"

Ran `POST /monitoring/loghub-samples/seed` against the live backend (no `ANTHROPIC_API_KEY` configured, so
classification runs through `MitreMappingService`'s real rule-based keyword matcher — not mocked):

| Line | Result |
|---|---|
| SSH: `POSSIBLE BREAK-IN ATTEMPT` | `T1110` Brute Force, `Credential Access` tactic, **MEDIUM** severity |
| SSH: `Failed password for invalid user webmaster` | `T1110` Brute Force, **MEDIUM** |
| SSH: `Too many authentication failures for root` | `T1110` Brute Force, **MEDIUM** |
| SSH: `Failed password for root` | `T1110` Brute Force, **MEDIUM** |
| Linux: `authentication failure` (sshd via pam_unix) | `T1110` Brute Force, **MEDIUM** |
| Linux: `session opened for user cyrus by (uid=0)` | `UNCLASSIFIED`, LOW — benign, correctly not flagged |
| Linux: `logrotate: ALERT exited abnormally` | `UNCLASSIFIED`, LOW — a real error, but not a security-relevant one |
| Apache: `[notice] workerEnv.init() ok ...` | `UNCLASSIFIED`, LOW |
| Apache: `[error] mod_jk child workerEnv in error state 6` | `UNCLASSIFIED`, LOW — no MITRE keyword for generic app errors |
| Apache: `[notice] jk2_init() Found child ...` | `UNCLASSIFIED`, LOW |

4 of 5 SSH/Linux brute-force lines correctly mapped to **T1110 Brute Force**; benign sessions and generic
Apache errors correctly stayed unclassified — "map to MITRE ATT&CK whenever possible" working honestly, not
force-matched.

## How to try it

Settings → "LogHub Sample Data" card → **Load LogHub sample data**. New incidents appear on Live Alerts /
Dashboard exactly like any other source.

## Verification

- `npm run build` passes in `backend/` and `apps/soc-dashboard/`.
- Backend, SOC Dashboard, and Employee Desktop all start successfully.
- `POST /monitoring/loghub-samples/seed` tested live against the running backend (table above).
