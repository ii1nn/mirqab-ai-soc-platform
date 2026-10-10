# Mirqab Backend (NestJS API)

## Setup

```bash
cp .env.example .env        # then fill in real secrets
npm install
npm run prisma:migrate      # creates the database schema (requires Postgres running)
npm run prisma:seed         # bootstraps the first ADMIN user from ADMIN_EMAIL/ADMIN_PASSWORD
npm run start:dev
```

The API listens on `http://localhost:3000/api/v1` by default.

## Authentication module (Phase 2)

- **JWT access + refresh tokens.** Access tokens are short-lived (default 15m)
  and carry `{ sub, email, role }`. Refresh tokens (default 7d) additionally
  carry a `tokenId` matching a `RefreshToken` row in Postgres.
- **Rotation + reuse detection.** Every `/auth/refresh` call revokes the
  presented token and issues a new pair. Only the SHA-256 hash of a refresh
  token is stored — a stolen DB dump can't be replayed. If an already-revoked
  token is presented again (a sign of token theft), the entire token family
  for that user is revoked.
- **RBAC.** `Role` (`ADMIN`, `SECURITY_ANALYST`, `IT_TECHNICIAN`, `EMPLOYEE`)
  lives on the Prisma `User` model. `@Roles(...)` + the global `RolesGuard`
  enforce it; `@Public()` opts a route out of the global `JwtAuthGuard`.
- **Endpoints:**
  | Method | Path | Access |
  |---|---|---|
  | POST | `/auth/register` | `ADMIN` only |
  | POST | `/auth/login` | Public |
  | POST | `/auth/refresh` | Public (requires valid refresh token) |
  | POST | `/auth/logout` | Authenticated |
  | GET | `/auth/me` | Authenticated |

## AI engine (Phase 5)

`src/modules/ai/` — analyzes raw log/alert text end-to-end: classify →
assign severity → map to MITRE ATT&CK → recommend fixes → persist an
`Incident` → auto-create a `Ticket` if severity is HIGH/CRITICAL → embed it
for similarity search → generate an employee-friendly notification and a
brief analyst heads-up.

- **Claude integration** (`claude/claude.service.ts`) — wraps
  `@anthropic-ai/sdk`, using `output_config.format` (JSON-schema structured
  outputs) rather than a tool-use round trip, since this is single-shot
  classification/generation, not a multi-turn agent loop. System prompts are
  marked `cache_control: { type: "ephemeral" }` since the same prompt is
  reused on every call of a given task type. **Fully optional**: with no
  `ANTHROPIC_API_KEY`, `ClaudeService.isAvailable()` is `false` and every
  caller falls back to a deterministic rule-based path — the API never 500s
  for lack of a key. `stop_reason: "refusal"` is handled explicitly and also
  triggers the fallback.
- **MITRE ATT&CK mapping** (`mitre-attack/`) — a small, accurate reference
  table (T1566 Phishing, T1110 Brute Force, T1204 User Execution, T1046
  Network Service Discovery, T1068 Privilege Escalation, T1486 Ransomware,
  T1071 C2, T1053 Persistence, T1078 Valid Accounts, T1059 Command/Scripting
  Interpreter, T1105 Ingress Tool Transfer, T1567 Exfiltration) plus a
  keyword matcher. Used both as the offline fallback and to reject a
  hallucinated technique ID from Claude's output.
- **Incident Similarity Engine** (`similarity-engine/`) — a FAISS
  `IndexFlatIP`-equivalent: feature-hashing text embeddings, L2-normalized,
  compared by cosine similarity (= dot product on normalized vectors). This
  is exact brute-force nearest-neighbor search, implemented natively so the
  backend doesn't depend on a native FAISS binary in Node/Docker — adequate
  for a SOC's incident volume. Vectors persist in the new `IncidentMemory`
  table (Postgres `Float[]`, no pgvector extension needed).
- **Endpoints** (Admin/Security Analyst/IT Technician only):
  | Method | Path | Purpose |
  |---|---|---|
  | POST | `/ai/analyze` | Full triage pipeline on a raw log excerpt |
  | GET | `/ai/incidents` | List recent incidents |
  | GET | `/ai/incidents/:id` | Get one incident (+ tickets, notifications) |
  | GET | `/ai/incidents/:id/similar` | Similarity search |
  | POST | `/ai/incidents/:id/analyst-report` | Generate a technical Markdown report on demand |

Run `npm run prisma:migrate` after pulling this phase — it adds `Incident`,
`Ticket`, `IncidentMemory`, and `Notification` tables.

## Domain modules + real-time audit trail (Phase 6)

- **`departments/`, `devices/`, `policies/`, `audit-logs/`, `tickets/`** —
  fill out the modules Phase 5 deferred. `Incident.departmentId`/`deviceId`
  are now real Prisma relations (were plain optional strings in Phase 5).
  `Ticket.departmentId`/`deviceId` stay denormalized plain strings, copied
  from the parent incident at creation — a ticket reflects where the
  incident was made, not a live FK that could break if the device moves.
- **`DevicesService.withComputedStatus()`** derives `status`
  (`ONLINE`/`AT_RISK`), `currentScore`, and `activeIncidentCount` at query
  time from each device's OPEN incidents in the last 5 minutes — nothing is
  persisted; it's recomputed on every read.
- **`AuditLogsService`** is now wired into `AuthService` (sign-in/out),
  `UsersController` (deactivate/reactivate), `PoliciesService` (toggle), and
  `TicketsService` (status change/reassign) — every meaningful mutation logs
  a real row instead of relying on the frontend to record it client-side.
- **`AiService.analyzeLog()`** no longer accepts `departmentId` from the
  caller — it resolves the `Device` by `deviceId` and derives
  `departmentId` from the device relation, so a request can't claim a
  department its device doesn't belong to. Added
  `PATCH /ai/incidents/:id/status`.
- **Endpoints added:**
  | Method | Path | Access |
  |---|---|---|
  | GET | `/departments`, `/departments/:id` | ADMIN / SECURITY_ANALYST / IT_TECHNICIAN |
  | GET | `/devices?departmentId=`, `/devices/:id` | ADMIN / SECURITY_ANALYST / IT_TECHNICIAN |
  | GET | `/policies` | ADMIN / SECURITY_ANALYST / IT_TECHNICIAN |
  | PATCH | `/policies/:id/toggle` | ADMIN / SECURITY_ANALYST |
  | GET | `/audit-logs` | ADMIN / SECURITY_ANALYST |
  | GET | `/tickets` | ADMIN / SECURITY_ANALYST / IT_TECHNICIAN |
  | PATCH | `/tickets/:id/status`, `/tickets/:id/assignee` | ADMIN / SECURITY_ANALYST / IT_TECHNICIAN |
  | PATCH | `/ai/incidents/:id/status` | ADMIN / SECURITY_ANALYST / IT_TECHNICIAN |

Run `npm run prisma:migrate` again after pulling this phase — it adds
`Department`, `Device`, `Policy`, and `AuditLog` tables, and changes
`Incident`'s department/device columns to real foreign keys. Also bumps
`@anthropic-ai/sdk` to `^0.115.0` (the `^0.32.0` Phase 5 shipped with
predates the `output_config.format`/`cache_control` shapes actually used in
`claude.service.ts` — this was a latent bug, not a Phase 6 change, only
caught once the build was actually run). See `docs/phases/phase-6.md`.

## Real-time WebSocket layer (Phase 7)

`src/modules/websocket/` — a Socket.IO gateway (`RealtimeGateway`) on
namespace `/realtime`, dashboard-only (same role boundary as every REST
domain endpoint: `ADMIN`/`SECURITY_ANALYST`/`IT_TECHNICIAN`, `EMPLOYEE`
connections are rejected).

- **Handshake auth** — the client sends its JWT access token via
  `socket.handshake.auth.token`; `handleConnection()` verifies it with the
  same `jwt.accessSecret` the REST `JwtStrategy` uses, looks the user up,
  and disconnects immediately on a missing/invalid token, inactive user, or
  disallowed role.
- **`@nestjs/event-emitter` decouples emitters from the gateway.**
  `AiService`, `TicketsService`, `PoliciesService`, and `AuditLogsService`
  emit named events (`incident.created`, `incident.updated`,
  `ticket.created`, `ticket.updated`, `policy.updated`,
  `audit-log.created` — see `modules/websocket/events.ts`) after their
  Prisma writes succeed. `RealtimeGateway` is the only listener and
  broadcasts each one to every connected socket via `server.emit()`. None
  of those four services import the websocket module or know a gateway
  exists — they only depend on the globally-injectable `EventEmitter2`.
- No new HTTP endpoints — this is a Socket.IO connection to the same port
  the REST API listens on, not a separate server.

Run `npm test` after pulling this phase — `realtime.gateway.spec.ts` covers
connection auth (accepted/rejected cases) and event broadcasting. See
`docs/phases/phase-7.md`.

## Device monitoring ingestion + Docker deployment (Phase 8)

`src/modules/monitoring/` — three endpoints for real Wazuh/Suricata/Sysmon
telemetry to reach the same triage pipeline Simulation Mode has been driving
since Phase 6:

| Method | Path | Access |
|---|---|---|
| POST | `/monitoring/wazuh` | Shared `X-Api-Key` (headless agent, not a dashboard user) |
| POST | `/monitoring/suricata` | Shared `X-Api-Key` |
| POST | `/monitoring/sysmon` | Shared `X-Api-Key` |

Each endpoint normalizes that vendor's native alert shape into the same log
excerpt `POST /ai/analyze` accepts and calls `AiService.analyzeLog()`
in-process — real and simulated telemetry converge on one detection path.
The reporting hostname resolves to a registered `Device` via
`DevicesService.findByHostname()`; an unrecognized hostname still gets
ingested, just without device/department context, with a logged warning.
Auth is a shared secret (`MONITORING_INGEST_API_KEY`, new required env var)
compared with `crypto.timingSafeEqual`, not JWT — these are headless
forwarders, not user sessions. See `docs/phases/phase-8.md` and
`infra/monitoring/` for the agent-side integration scripts (Wazuh custom
integration, a Suricata `eve.json` tail, a Sysmon Scheduled Task).

`backend/Dockerfile` + `docker-entrypoint.sh` (new) run `prisma migrate
deploy` and the (idempotent) seed script on every container boot before
starting the server — see `infra/docker/docker-compose.yml` for the full
Postgres/Redis/backend/dashboard/nginx stack.

## Redis-backed realtime scaling + TLS (Phase 9)

`src/redis/redis.service.ts` gives the Redis container Phase 8 provisioned
its first real consumer: `RealtimeGateway.afterInit()` asks it for a
connected `ioredis` pub/sub pair and, if `REDIS_URL` is set, installs
`@socket.io/redis-adapter` so `server.emit()` broadcasts reach every backend
replica's connected sockets, not just the one whose domain service emitted
the event — necessary the moment more than one backend instance runs behind
a load balancer, a no-op otherwise. `REDIS_URL` unset (the default) keeps
`RealtimeGateway` running exactly as it did in Phase 7, no adapter installed.

`infra/docker/nginx/` now terminates TLS (see `docs/phases/phase-9.md`):
port 80 redirects to port 443, `certs/generate-self-signed-cert.sh`
generates a local dev cert (never commit the output — see `certs/.gitignore`
and the new root `.gitignore`), and a real deployment swaps in a CA-issued
cert in its place.

## Scripts

- `npm run start:dev` — watch mode
- `npm run test` / `npm run test:cov` — unit tests
- `npm run prisma:studio` — inspect the database
- `npm run lint` / `npm run format`

## Running it for real (Phase 10)

`docker compose up --build` (from `infra/docker/`) was actually run
end-to-end for the first time in Phase 10, which surfaced and fixed four
real bugs no unit test or `npm run build` could have caught: Prisma's
engine needing `openssl` actually installed on Alpine (not just detected at
generate time), a complete absence of any Prisma migration anywhere in the
repo (only `.gitkeep` had ever sat in `migrations/`), the Dockerfile's
runtime stage never copying that folder into the image even once one
existed, and Joi's `.optional()` rejecting the present-but-empty
`ANTHROPIC_API_KEY=`/`REDIS_URL=` both `.env.example` files ship. See
`docs/phases/phase-10.md` for the full list and `scripts/test-login.ps1`
for a repeatable smoke test through the real nginx entrypoint.

## Multi-replica scaling — proven live (Phase 11)

`infra/docker/nginx/nginx.conf`'s static `upstream backend {...}` block
(Phase 8) resolved that hostname once at nginx startup — correct for one
replica, silently wrong for more. Fixed with `resolver 127.0.0.11 valid=10s;`
(Docker's embedded DNS) plus a `proxy_pass http://$backend_upstream;`
*variable* — the variable is what actually forces per-request
re-resolution, not the `resolver` directive alone. Verified live, not just
reviewed: scaled to 3 backend replicas (`docker compose up -d --scale
backend=3`), fired 15 requests (`scripts/test-scaling.ps1`), and confirmed
via nginx's access log (`$upstream_addr`) that all 3 replica IPs actually
served traffic. See `docs/phases/phase-11.md`.

## Employee Desktop connectivity (Phase 12)

The `backend` service now publishes container port 3000 to a random host
port (`ports: ['3000']`, deliberately not a fixed `'3000:3000'`, which
would break `--scale backend=N` the same way a fixed nginx upstream did in
Phase 11). `docker compose port backend 3000` reports the assigned port;
`CORS_ORIGIN` includes `apps/employee-desktop`'s Vite dev origin
(`http://localhost:5174`) so it can reach this backend directly over plain
HTTP, unrelated to the nginx/TLS path the SOC Dashboard uses. Verified live
with `scripts/test-employee-desktop-connectivity.ps1`. See
`docs/phases/phase-12.md` for why this was chosen over adding self-signed
certificate trust to Employee Desktop's Electron process.

## Monitoring ingestion, actually run (Phase 13)

`/monitoring/wazuh`, `/monitoring/suricata`, and `/monitoring/sysmon` had
only ever been exercised by `monitoring.service.spec.ts` (a mocked
`AiService`) until this phase — `scripts/test-monitoring-ingestion.ps1`
sends real payloads through the live, running backend and confirms real
incidents via `GET /ai/incidents`, including a genuine sshd log line
correctly coming back `UNCLASSIFIED` (real-world text the rule-based
matcher doesn't recognize — the documented, intended fallback, now
actually demonstrated) and an unregistered hostname ingesting successfully
with no `deviceId`. `infra/monitoring/suricata/eve-forwarder.js` — the real
shipped script, not a re-implementation — was also actually run against a
live growing `eve.json`, via `scripts/test-suricata-forwarder.ps1`, and
created a real incident. See `docs/phases/phase-13.md`.

## Status: complete

All 13 planned phases are implemented and verified. The only remaining
items are environment limitations of this specific sandbox, not gaps in
the backend itself:

- A real CA-issued TLS cert needs a public domain this sandbox doesn't
  have — `infra/docker/nginx/` is otherwise a complete, correct TLS
  termination setup (self-signed dev cert only). See `docs/phases/phase-9.md`.
- The Wazuh (`.py`) and Sysmon (`.ps1`) monitoring scripts were reviewed
  and their target endpoints verified live (`scripts/test-monitoring-ingestion.ps1`
  proves the exact payload shape each script builds is accepted and
  produces a real incident) — but the scripts themselves were never
  executed, since this environment has neither Python nor a Sysmon
  install. Installing either is a one-step action in an environment that
  has them; not done here since it wasn't explicitly requested. See
  `docs/phases/phase-13.md`.

See the root `README.md`'s "Known Limitations" section for the same list
in full.
