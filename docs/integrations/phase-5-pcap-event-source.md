# Integration Phase 5 — PCAP-Derived Event Source

**Scope:** integrate PcapMonkey's normalized network-event output as a new ingestion source, without
installing any PCAP tooling (no tshark, no Zeek/Suricata) — reusing the exact same architecture and
Incident pipeline every prior phase used, add real test coverage, and verify with real builds.

## Why no tshark/Zeek

PcapMonkey itself is a Docker/Zeek/Suricata pipeline — heavy infrastructure this project deliberately
doesn't stand up. `datasets/PcapMonkey/zeek-sample-events.json` (see that folder's `NOTES.md`) is 6 real
records taken from PcapMonkey's *own test fixture* — the expected Zeek-via-Elasticsearch output (Elastic
Common Schema) its test suite asserts against — which is exactly the normalized shape a real deployment's
output would already be in. No `.pcap` file is parsed anywhere in this codebase.

## What was added

Same shape as every prior phase's vendor source (`ingestWazuh`/`ingestSuricata`/`ingestSysmon`/`ingestSyslog`):

- **`dto/pcap-event.dto.ts`** — `PcapEventDto`: `dataset` (ECS `event.dataset`, e.g. `"zeek.notice"`),
  `sourceIp`/`sourcePort`, `destinationIp`/`destinationPort`, `transport`, `detail` (a normalized
  protocol-specific one-line summary — same decoded/raw split every other DTO here uses), `timestamp`.
- **`MonitoringService.ingestPcap()`** + **`POST /monitoring/pcap`** on the existing `MonitoringController` —
  same `@Public()` + API-key-guarded setup as the other four sources.
- **`DevicesService.findByIpAddress()`** — new, mirrors `findByHostname()` exactly (`findFirst` since
  `ipAddress` isn't a unique column; same "return null rather than reject" contract). PCAP-derived events
  only ever carry an IP, never a hostname, so device resolution needed this new lookup — the one small
  cross-module addition this phase required.
- **`pcap-samples/` submodule** (parser, 6 real bundled ECS records, service, controller) — mirrors
  `wazuh-samples/`/`loghub-samples/` exactly, exposed as `POST /monitoring/pcap-samples/seed`.
- Dashboard: `monitoringService.seedPcapSamples()` + a third Settings card, same pattern as the other two.

### No new database tables, no changes to AiService

Same as every prior phase — events land in the existing `Incident` table via the same
`AiService.analyzeLog()` call, same classification, same auto-ticketing, same realtime events, same
dashboard display.

## Real test coverage (per your instruction — not skipped)

- **`pcap-sample.parser.spec.ts`** (5 tests) — all 6 bundled records parse without drops, fields carry
  through unchanged, and each dataset type's `detail` summary contains its real, distinguishing content
  (e.g. the `zeek.notice` test asserts the actual `SSL::Invalid_Server_Cert` rule name and description
  appear, not a placeholder).
- **`monitoring.service.spec.ts`** — extended with an `ingestPcap` describe block (2 tests): confirms the
  excerpt is built from the flow/detail fields, confirms device resolution goes through
  `findByIpAddress()` (not `findByHostname()`), and confirms the graceful no-device fallback.

**`npx jest` (full backend suite), run for real:**

```
Test Suites: 9 passed, 9 total
Tests:       53 passed, 53 total
```

(46 from before this phase + 5 new parser tests + 2 new `ingestPcap` tests = 53; zero regressions.)

## Verification

- `backend`, `apps/soc-dashboard`, `apps/employee-desktop` all `npm run build` clean.
- Backend hot-reloaded with the new `/monitoring/pcap` and `/monitoring/pcap-samples/seed` routes
  registered, no startup errors.
- **Live**, against the running backend: `POST /monitoring/pcap-samples/seed` → `ingested: 6`, one incident
  per Zeek dataset type. Fetched one incident back via the existing `GET /ai/incidents/:id` and confirmed
  its `sourceExcerpt` matches exactly what the parser/service produced.

## Honest result: all 6 land UNCLASSIFIED/LOW, and why

Under the rule-based fallback (no `ANTHROPIC_API_KEY` in this environment), every one of the 6 events
classified as `UNCLASSIFIED`/`LOW` — including the `zeek.notice` self-signed-certificate alert and the
`zeek.http` request serving an `application/x-dosexec` payload, both of which a security analyst (or Claude,
if configured) would flag as suspicious. This isn't a bug: `MitreMappingService`'s 12 curated techniques
(`docs/integrations/phase-4-ai-training-records.md` covers the same list) are host/process-centric keywords
(`'powershell'`, `'failed authentication'`, `'ransomware'`, ...) — none target network-flow language like
"self signed certificate" or "dosexec". This is the same class of honest limitation Phase 4 documented for
the real EVTX record: reported as-is rather than papered over by stuffing excerpt text with unrelated
keywords just to force a "correct-looking" result. A real deployment with Claude enabled would very likely
classify the notice/http events correctly via actual reasoning rather than keyword matching.
