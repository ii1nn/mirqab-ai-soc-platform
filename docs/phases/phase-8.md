# Phase 8 — Device Monitoring Ingestion + Docker Compose Deployment

**Scope:** let real Wazuh/Suricata/Sysmon telemetry reach the same `/ai/analyze`
triage pipeline Simulation Mode has been driving since Phase 6, and give the
whole platform (backend + Postgres + Redis + SOC Dashboard) a single
`docker compose up` deployment path. No SOC Dashboard UI changes — monitoring
agents are headless machine clients, not something a dashboard user interacts
with directly.

## What was built

### Backend — `modules/monitoring/`

- **Three ingestion endpoints**, one per vendor's native alert shape:
  `POST /monitoring/wazuh`, `POST /monitoring/suricata`,
  `POST /monitoring/sysmon`. Each DTO (`dto/*.dto.ts`) validates the fields
  that vendor's alert format actually carries (Wazuh's `rule`/`agent`/
  `full_log`, Suricata eve.json's `alert`/`src_ip`/`dest_ip`, a Sysmon event's
  `Computer`/`EventID`/-variable fields per event type).
- **`MonitoringService`** normalizes each shape into the same plain-text log
  excerpt `AiService.analyzeLog()` already accepts, resolves the reporting
  hostname to a registered `Device` via the new
  `DevicesService.findByHostname()`, and calls `analyzeLog()` in-process —
  the exact same triage/classification/MITRE-mapping/ticket-creation path
  Simulation Mode's event generator calls over HTTP. Real and simulated
  telemetry now converge on one code path; this module's only job is
  vendor-specific text normalization, not reimplementing detection.
  An unrecognized hostname doesn't reject the event — it's still ingested,
  just without device/department context, logged as a warning so an
  operator notices an unenrolled host reporting in.
- **`MonitoringApiKeyGuard`** — these are headless agents, not dashboard
  users, so the JWT flow doesn't fit. Routes are `@Public()` (opted out of
  the global `JwtAuthGuard`) and gated instead by a shared-secret
  `X-Api-Key` header, compared with `crypto.timingSafeEqual` against
  `MONITORING_INGEST_API_KEY` (new required env var — no rule-based fallback
  makes sense for an auth check, unlike the AI classification path).
- **Tests**: `monitoring.service.spec.ts` covers all three normalizers
  (excerpt content, device resolution, the unmapped-hostname fallback, an
  unmapped Sysmon Event ID falling back to a generic label rather than
  failing). `monitoring-api-key.guard.spec.ts` covers accept/reject/
  missing-key/wrong-length-key/unconfigured-key.

### Backend — Docker

- `backend/Dockerfile`'s runtime stage now copies the build stage's full
  `node_modules` (including the `prisma` CLI and its cached engine binaries)
  instead of a slim `--omit=dev` reinstall, because `docker-entrypoint.sh`
  runs `prisma migrate deploy` on every container boot — doing that via
  `npx` against a slim install would need network access to fetch the CLI
  at container start, which a production or air-gapped deployment may not
  have. The entrypoint also runs the (upsert-based, already-idempotent)
  seed script every boot rather than gating it behind a "first run" flag.

### Infra — `infra/docker/` (Docker Compose stack)

- **`docker-compose.yml`** — `postgres` (16-alpine), `redis` (7-alpine,
  `appendonly yes`), `backend`, `soc-dashboard`, and a top-level `nginx`
  reverse proxy as the only published port (80).
- **`apps/soc-dashboard/Dockerfile`** (new) — multi-stage: `npm run build`
  with `VITE_API_BASE_URL=/api/v1` baked in as a *relative* path (Vite
  inlines `import.meta.env.*` at build time), then a plain `nginx:alpine`
  serving the static `dist/` with an SPA `try_files` fallback. Relative API
  base URL means the browser calls the same origin the page loaded from —
  the top-level nginx owns same-origin-ness, so there's no CORS
  configuration needed in the browser-facing path at all.
- **`infra/docker/nginx/nginx.conf`** — the actual reverse proxy: `/api/v1/`
  → `backend`, `/` → `soc-dashboard`, and `/socket.io/` → `backend` with
  `Upgrade`/`Connection` headers for the WebSocket handshake. That last path
  matters specifically: Socket.IO's namespace (`/realtime`, see Phase 7) is
  negotiated inside the handshake payload, not the URL — the transport-level
  HTTP endpoint is always `/socket.io/` regardless of namespace, so that's
  the path nginx has to route, not `/realtime`.
- **`infra/docker/redis/redis.conf`** — minimal persistence config. Flagged
  explicitly in both the config's own comment and here: **nothing in the
  backend consumes Redis yet.** It's provisioned because the root README
  already declared Redis as part of the shared architecture, and Phase 7's
  docs floated it as a future swap-in for the WebSocket gateway's Socket.IO
  adapter (multi-instance pub/sub) — but actually wiring that up is out of
  this phase's scope, and pretending otherwise would misrepresent what
  exists. It sits idle in the compose stack until a real consumer lands.
- **`apps/employee-desktop` is deliberately not containerized.** It's an
  Electron installer distributed to endpoints, not a web service — there's
  nothing meaningful for a reverse proxy to route to. The "both frontends"
  phrasing in the Phase 7-era roadmap blurb was aspirational language, not a
  real requirement once you consider what Electron packaging actually is;
  this phase corrects that in the root README's roadmap entry.

### Infra — `infra/monitoring/` (agent-side reference configs)

Not part of the Node/TS build or test suite — these are ops-side scripts for
wiring a *real* monitoring stack to the two ingestion endpoints above, the
same way a Dockerfile is real but isn't unit-tested:

- **`wazuh/mirqab-integration.py`** + `ossec-integration-snippet.xml` — a
  Wazuh custom integration script (the manager invokes it per-alert) and the
  `<integration>` block wiring it into `ossec.conf`.
- **`suricata/eve-forwarder.js`** — a dependency-free Node script tailing
  `eve.json` and forwarding `alert`-type events. Explicitly documented as a
  minimal reference tail (no persisted offset across restarts) — production
  use should swap it for a real log shipper.
- **`sysmon/sysmon-forwarder.ps1`** — a PowerShell Scheduled-Task script
  polling the local Sysmon operational log, tracking the last forwarded
  `RecordId` in a state file so re-runs don't double-send.

Each has its own `README.md` with install/run instructions.

## Design decisions worth flagging

- **In-process call, not another HTTP round trip.** `MonitoringService`
  calls `AiService.analyzeLog()` directly — both live in the same backend
  process — rather than the monitoring endpoints making an HTTP request to
  `/ai/analyze` on themselves. Simulation Mode's event generator goes over
  HTTP because it's a separate frontend process; real monitoring ingestion
  has no such boundary to cross.
- **Vendor text is passed through mostly as-is, not reworded to match
  keyword lists.** The rule-based MITRE matcher (Phase 5) and Claude
  classification (when available) both operate on genuine IDS/EDR
  vocabulary now, not phrasing hand-tuned to trigger a specific technique —
  an `UNCLASSIFIED` result on real-world text the matcher doesn't recognize
  is a correct outcome, not a bug, exactly as it already was for Simulation
  Mode's `analyzeLog()` callers.
- **Unresolved hostnames don't reject the event.** Requiring device
  pre-enrollment before an alert can be ingested would silently drop
  security-relevant events for the small window between an endpoint going
  live and someone remembering to register it in Mirqab. A logged warning
  is the safer failure mode.
- **A shared API key, not per-agent credentials.** Real Wazuh/Suricata/
  Sysmon deployments authenticate the *collection tier* (the manager, the
  sensor, the forwarding script) once, not each individual monitored
  endpoint — matching that boundary keeps the guard a single comparison
  instead of a credential-management subsystem this phase doesn't need.

## Verification

- `backend`: `npm run build` (nest build) — clean, zero errors. `npm test`
  (jest) — `6 suites / 35 tests`, all passing (25 pre-existing + 10 new:
  5 `MonitoringService` cases, 5 `MonitoringApiKeyGuard` cases).
- Docker Compose stack itself (`docker compose up --build` end-to-end
  against a live Docker daemon) has **not** been run in this environment —
  no Docker installation available here. The Dockerfiles/compose file are
  reviewed for correctness (build stages, env wiring, healthcheck
  ordering, the `/socket.io/` proxy path) but not executed. Treat this as
  the one unverified piece of this phase until it's run somewhere with
  Docker available.

## Next

Beyond this phase, remaining open items: actually wiring Redis to something
(the Socket.IO Redis adapter for horizontal gateway scaling is the leading
candidate, per Phase 7's docs), TLS termination at the nginx layer for a
real (non-`localhost`) deployment, and running the Compose stack end-to-end
to confirm the reference configs above are exactly right rather than
reviewed-correct.
