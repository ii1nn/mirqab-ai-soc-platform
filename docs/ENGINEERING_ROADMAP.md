# Mirqab — Enterprise SOC Platform

Mirqab is a production-grade Security Operations Center (SOC) platform consisting
of two applications sharing a common backend and AI engine.

> **Status: Complete.** All 13 planned phases are implemented and verified —
> see "Known Limitations" at the end of the roadmap below for the handful
> of items that are genuinely environment constraints of this sandbox
> (no public domain, no Python/Sysmon installed here), not gaps in the
> implementation itself.

## Applications

- **Mirqab Employee** (`apps/employee-desktop`) — Electron + React desktop app
  installed on employee devices (login, device health, AI scan, notifications,
  security score, device info, incident history, recommended fixes).
- **Mirqab SOC Dashboard** (`apps/soc-dashboard`) — React + Vite + TypeScript web
  app used by IT/Security teams (Dashboard, Live Alerts, Devices, Departments,
  Threat Map, Tickets, Policies, Reports, Analytics, Incident Memory, Settings,
  User Management, Audit Logs, The Citadel Live View).

## Shared Systems

- **Backend** (`backend`) — NestJS + PostgreSQL + Prisma + JWT/RBAC + WebSocket + Redis.
  Includes the **AI engine** (`backend/src/modules/ai`) — Claude API
  integration, a FAISS-equivalent similarity engine, MITRE ATT&CK mapping.
  The standalone `ai-engine/` folder below predates that decision (see
  `docs/phases/phase-5.md` → Design decisions) and is currently unused.
- **Shared packages** (`packages`) — cross-app TypeScript types, UI kit, shared config.
- **Infra** (`infra`) — Docker Compose stack (Postgres, Redis, Nginx), Wazuh/Suricata
  monitoring config, simulation environment assets.

## Monorepo Layout

```
mirqab/
├── apps/
│   ├── soc-dashboard/        # React + Vite + TS web dashboard
│   └── employee-desktop/     # Electron + React desktop client
├── backend/                  # NestJS API
│   └── src/
│       ├── modules/          # auth, users, devices, departments, tickets,
│       │                     # alerts, incidents, policies, audit-logs,
│       │                     # notifications, threat-intel, incident-memory,
│       │                     # ai/{claude,mitre-attack,similarity-engine},
│       │                     # monitoring (Wazuh/Suricata/Sysmon ingestion),
│       │                     # websocket, simulation
│       ├── common/           # decorators, filters, guards, interceptors, pipes, rbac
│       ├── config/
│       ├── database/         # prisma schema/migrations, seed
│       └── redis/
├── ai-engine/                # FAISS + Claude client + MITRE mapping service
├── packages/                 # shared-types, ui-kit, config
├── infra/
│   ├── docker/               # docker-compose.yml, backend/dashboard Dockerfiles, nginx reverse proxy, redis config
│   └── monitoring/           # wazuh, suricata, sysmon agent-side integration scripts
└── docs/                     # architecture & phase docs
```

## Roadmap (Phased Delivery)

1. **Phase 1 — Project structure** ✅ folders only, no code.
2. **Phase 2 — Authentication module** ✅ NestJS + Prisma User/RefreshToken
   models, JWT access/refresh with rotation + reuse detection, RBAC guards.
   See `backend/README.md` and `docs/phases/phase-2.md`.
3. **Phase 3 — Employee Desktop application** ✅ Electron + React agent with
   real device telemetry (CPU/RAM/disk/Defender/firewall/processes/apps via
   IPC), a deterministic security-score engine, backend-integrated auth with
   encrypted refresh-token storage, and clearly-marked mock data only where a
   backend module doesn't exist yet (AI scan classification, two sample
   incidents). See `apps/employee-desktop/README.md` and `docs/phases/phase-3.md`.
4. **Phase 4 — SOC Dashboard application** ✅ all 13 spec'd pages, built on a
   real client-side Simulation Mode engine (5 departments, virtual devices,
   5 attack scenarios tagged with real MITRE ATT&CK technique IDs) that
   drives Dashboard/Live Alerts/Devices/Departments/Threat Map/Tickets/
   Analytics — plus real backend-integrated auth, User Management, and a
   genuine session audit log. See `apps/soc-dashboard/README.md` and
   `docs/phases/phase-4.md`.
5. **Phase 5 — AI engine** ✅ `backend/src/modules/ai` — Claude-powered log
   classification, severity assignment, and MITRE ATT&CK mapping (12 real
   technique references, validated against Claude's output to catch
   hallucination), a FAISS-`IndexFlatIP`-equivalent Incident Similarity
   Engine implemented natively (no fragile native FAISS binary), automatic
   ticket creation on HIGH/CRITICAL incidents, and employee-friendly +
   analyst notifications. Every Claude call has a genuine rule-based
   fallback, so the API works with or without an `ANTHROPIC_API_KEY`. See
   `backend/README.md` and `docs/phases/phase-5.md`.
6. **Phase 6 — Wire the dashboard to the real backend** ✅ built the
   remaining domain modules (Departments, Devices, Policies, AuditLogs,
   Tickets), turned `Incident.departmentId`/`deviceId` into real Prisma
   relations, and rewired every SOC Dashboard page off Phase 4's
   client-side Simulation Mode onto real backend data via a new
   adapter/service/hook layer. Simulation Mode itself was rebuilt as a real
   event generator that posts synthetic log excerpts to the genuine
   `POST /ai/analyze` pipeline rather than faking data client-side — the
   whole system now runs on one real data path. See
   `apps/soc-dashboard/README.md`, `backend/README.md`, and
   `docs/phases/phase-6.md`.
7. **Phase 7 — Real-time WebSocket layer** ✅ `backend/src/modules/websocket`
   — a Socket.IO gateway (`/realtime` namespace, dashboard roles only) that
   authenticates the handshake with the same JWT access token the REST API
   uses. `AiService`/`TicketsService`/`PoliciesService`/`AuditLogsService`
   emit domain events through `@nestjs/event-emitter` (`EventEmitter2`),
   decoupling those services from the gateway entirely — it's the only
   listener, broadcasting each event to every connected socket. On the
   dashboard, `hooks/useRealtimeSync.ts` turns those events into React Query
   cache invalidations (never direct cache writes, keeping the REST adapter
   layer authoritative), with polling demoted from a 5–10s primary loop to a
   30s safety net. See `apps/soc-dashboard/README.md`, `backend/README.md`,
   and `docs/phases/phase-7.md`.
8. **Phase 8 — Device monitoring ingestion + Docker Compose deployment** ✅
   `backend/src/modules/monitoring` — three endpoints
   (`POST /monitoring/{wazuh,suricata,sysmon}`) normalize each vendor's
   native alert shape into the same log excerpt `/ai/analyze` already
   accepts, so real IDS/EDR telemetry and Simulation Mode's synthetic events
   converge on one detection path. Auth is a shared `X-Api-Key` secret, not
   JWT — these are headless forwarders, not dashboard sessions.
   `infra/docker/docker-compose.yml` ties Postgres, Redis, the backend, and
   the SOC Dashboard together behind a single nginx reverse proxy;
   `infra/monitoring/` holds the agent-side integration scripts (a Wazuh
   custom integration, a Suricata `eve.json` forwarder, a Sysmon Scheduled
   Task). The Employee Desktop app is deliberately **not** containerized —
   it's an Electron installer distributed to endpoints, not a web service.
   See `backend/README.md` and `docs/phases/phase-8.md`.
9. **Phase 9 — Redis-backed realtime scaling + TLS** ✅
   `backend/src/redis/redis.service.ts` gives the Redis container Phase 8
   provisioned its first real consumer: `RealtimeGateway.afterInit()`
   installs `@socket.io/redis-adapter` when `REDIS_URL` is set, so
   WebSocket broadcasts reach every backend replica's connected sockets
   instead of only the one whose domain service emitted the event — a
   no-op with a single replica (all this stack currently runs), required
   the moment there's more than one. `infra/docker/nginx/` now terminates
   TLS (port 80 redirects to 443; `certs/generate-self-signed-cert.sh`
   generates a local dev cert) instead of serving plaintext HTTP. Added the
   repo's first root `.gitignore`, prompted directly by not wanting to
   accidentally commit a generated private key. See `backend/README.md` and
   `docs/phases/phase-9.md`.
10. **Phase 10 — actually running the stack end-to-end** ✅ started Docker
    Desktop's engine and ran `docker compose up --build` for real, which
    surfaced and fixed four bugs no unit test or `npm run build` could ever
    have caught: Prisma's schema engine needing `openssl` actually present
    on Alpine (not just detectable at generate time), a complete absence of
    any Prisma migration anywhere in the repo (only `.gitkeep` had ever sat
    in `migrations/` — every past "verification" was `npm test`, never
    `prisma migrate dev` against a live database), the backend Dockerfile's
    runtime stage never copying that folder into the image even once one
    existed, and Joi's `.optional()` rejecting the present-but-empty
    `ANTHROPIC_API_KEY=`/`REDIS_URL=` both `.env.example` files ship.
    Verified for real: the SOC Dashboard loads over HTTPS through nginx,
    and a login through `nginx → backend → Postgres` returns a genuine JWT
    (`scripts/test-login.ps1`). See `backend/README.md` and
    `docs/phases/phase-10.md`.
11. **Phase 11 — multi-replica backend scaling, proven live** ✅ nginx's
    static `upstream backend {...}` block (Phase 8) resolved that hostname
    once at startup — correct for one replica, silently wrong for more.
    Fixed with Docker's embedded DNS resolver plus a variable-based
    `proxy_pass` that forces per-request re-resolution, then actually
    scaled the live stack to 3 backend replicas and confirmed via nginx's
    access log that all 3 replica IPs served real traffic — not just a
    config review. Also: `apps/employee-desktop` had never once had
    `npm install` run in this checkout; doing so surfaced a real TypeScript
    generic-inference bug in `electron/ipc/device.ipc.ts`, now fixed, with
    `npm run build` clean. See `backend/README.md`,
    `apps/employee-desktop/README.md`, and `docs/phases/phase-11.md`
    (including why Employee Desktop isn't wired into the containerized
    stack directly — a deliberate tradeoff, not an oversight).
12. **Phase 12 — Employee Desktop connects to the Dockerized backend** ✅
    A real CA-issued TLS cert remains out of reach in this sandbox (no
    public domain to issue one for — restated, not solved). Employee
    Desktop's open question from Phase 11 *was* resolved, without either
    of the two options on the table: `backend`'s container port 3000 is
    now published to a random host port (not fixed, so it doesn't conflict
    with `--scale backend=N`), and `CORS_ORIGIN` now allows Employee
    Desktop's Vite dev origin — so it reaches the exact same containerized
    backend (same Postgres data, same seeded admin, same Redis-backed
    realtime layer) over plain HTTP, with zero Electron code changes and
    no certificate-trust risk. Verified live with
    `scripts/test-employee-desktop-connectivity.ps1`: `200`, correct CORS
    header, real access token. See `backend/README.md`,
    `apps/employee-desktop/README.md`, and `docs/phases/phase-12.md`.
13. **Phase 13 — monitoring ingestion pipeline run live, for real** ✅
    All three `/monitoring/*` endpoints (Phase 8) had only ever been
    exercised with a mocked `AiService` in unit tests — this phase sent
    real HTTP payloads through the actually-running backend and confirmed
    real incidents via `GET /ai/incidents`, including a genuine sshd log
    line correctly coming back `UNCLASSIFIED` (real-world text the
    rule-based matcher doesn't recognize — the documented fallback, now
    actually demonstrated rather than just asserted) and an unregistered
    hostname ingesting with no `deviceId`, exactly as designed. The real
    `infra/monitoring/suricata/eve-forwarder.js` script — not a
    re-implementation of its logic — was also run live against a growing
    `eve.json` file and created a real incident. The Wazuh (`.py`) and
    Sysmon (`.ps1`) scripts remain reviewed-but-not-executed: this
    environment has neither Python nor a Sysmon install, and installing
    either was treated as a deliberate decision rather than done
    unprompted. See `backend/README.md` and `docs/phases/phase-13.md`.
## Known Limitations

These are the project's only open items, and every one of them is a
constraint of *this specific sandboxed environment*, not an unfinished or
unverified piece of the implementation — the code, config, and endpoints
each item touches have already been verified as far as this environment
allows (see the phase links below), and each is a one-step action away
from being closed out in an environment where the constraint doesn't apply:

- **No real (CA-issued) TLS certificate.** Issuing one — via Let's Encrypt
  or any other CA — needs a publicly resolvable domain pointing at a real
  host (HTTP-01) or API access to a real DNS provider (DNS-01). Neither
  exists for a local sandbox with no public domain. `infra/docker/nginx/`
  terminates TLS correctly with a self-signed dev certificate
  (`certs/generate-self-signed-cert.sh`) — swapping in a real certificate
  on a real domain is a drop-in replacement of two files, not a design
  change. See `docs/phases/phase-9.md`.
- **The Wazuh integration script (`infra/monitoring/wazuh/mirqab-integration.py`)
  was reviewed and its target endpoint verified live, but the `.py` file
  itself was never executed** — this environment has no Python install
  (only the Windows Store app-execution-alias stub). `scripts/test-monitoring-ingestion.ps1`
  sends the same payload shape the script would build directly to
  `POST /monitoring/wazuh` and confirms a real incident is created, so the
  backend-side contract is proven; only the Python runtime to execute the
  script literally is missing from this machine. See `docs/phases/phase-13.md`.
- **The Sysmon forwarder script (`infra/monitoring/sysmon/sysmon-forwarder.ps1`)
  was reviewed and its target endpoint verified live, but never run against
  genuine Sysmon events** — no Sysmon installation exists on this machine,
  and installing one (a persistent, system-wide security-monitoring driver)
  was treated as a deliberate decision requiring explicit request, not
  something to do unprompted while verifying documentation. Same
  endpoint-contract verification applies as the Wazuh script above. See
  `docs/phases/phase-13.md`.

None of these represent missing functionality in the codebase itself —
they're the difference between "verified against the real endpoint
contract" and "verified with the literal named external tool installed,"
which this sandbox's constraints (no public domain, no Python, no Sysmon)
don't allow closing any further from here.

See `docs/phases/` for per-phase notes on all 13 completed phases.
