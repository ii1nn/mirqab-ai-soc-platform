# Mirqab SOC Dashboard

The web app used by IT and Security teams.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Requires the backend from `../../backend` running locally. Sign in with an
`ADMIN`, `SECURITY_ANALYST`, or `IT_TECHNICIAN` account — `EMPLOYEE` accounts
are rejected at login (this app is not the employee agent).

## Real backend, real Simulation Mode (Phase 6)

As of Phase 6, every page is wired to the real backend — Departments,
Devices, Policies, Audit Logs, and Tickets modules now exist server-side, and
`Incident.departmentId`/`deviceId` are real relations. There's no separate
mock data path anymore.

The platform spec calls for a **Simulation Mode** (attack scenarios against
virtual devices, driving real-time dashboard updates), so instead of removing
it once real backend modules existed, `src/simulation/` was rebuilt as a
thin **event generator pointed at the real pipeline**:

- `scenarios.ts` — 5 attack scenarios (phishing, brute force, malware/
  ransomware, port scan, privilege escalation), each building a realistic log
  excerpt for a given virtual device, phrased to match the backend's MITRE
  keyword matcher.
- `simulationEngine.ts` — a small Zustand store holding only
  `{ isRunning, lastError }`. Once started (topbar/Settings toggle), it ticks
  every 8s, picks a random device + scenario, and calls the real
  `POST /ai/analyze` via `services/incidents.service.ts`. It holds no data of
  its own — every alert, incident, ticket, and notification it triggers is
  genuinely persisted in Postgres by the same AI engine (Claude or the
  rule-based fallback) a real log source would hit.

Dashboard pages don't read from the simulation store at all; they fetch the
real endpoints via TanStack React Query hooks (`hooks/use*.ts`), kept fresh
by real-time push (see below). Simulation Mode is just one possible
producer of events — a real monitoring agent (Phase 8+) could point at the
same `/ai/analyze` endpoint and every page would behave identically.

### The backend/frontend enum adapter

The backend's Prisma enums are `UPPER_SNAKE_CASE` (`Severity.HIGH`,
`TicketStatus.IN_PROGRESS`); this app's components use lowercase/hyphenated
strings (`'high'`, `'in-progress'`) for CSS class and copy convenience.
`services/backend-types.ts` (raw response shapes) and `services/adapters.ts`
(`fromBackendX`/`toBackendX` converters) absorb that mismatch at the service
boundary, so page and widget code works with the same domain types Phase 4
introduced without needing to know about the backend's casing.

## Real-time push, not just polling (Phase 7)

`lib/socket.ts` opens a shared `socket.io-client` connection to the
backend's `/realtime` Socket.IO namespace once the user is authenticated
(the JWT access token is sent via `auth`, re-read on every reconnect so it
survives token refresh). `hooks/useRealtimeSync.ts` — mounted once in
`AppShell` — listens for `incident.created/updated`, `ticket.created/
updated`, `policy.updated`, and `audit-log.created`, and calls
`queryClient.invalidateQueries()` for the affected query key(s). An
incident event also invalidates `devices`, since device status/score are
derived server-side from open incidents.

The socket never writes data into the React Query cache directly — it only
triggers a refetch through the existing REST + adapter path, so
`services/adapters.ts` stays the single place backend response shapes get
converted. Polling (`refetchInterval`, now 30s across `incidents`,
`tickets`, `devices`, `audit-logs`, `policies`) is kept as a safety net for
a missed event or a reconnect gap, not the primary update mechanism
anymore.

## What's real

Everything. There is no more simulated-vs-real split — the table below is
kept for historical context on what changed since Phase 4:

| Page | Phase 4 | Phase 6/7 |
|---|---|---|
| Dashboard, Live Alerts, Devices, Departments, Threat Map, Tickets, Analytics | Client-side Simulation Mode | Real backend, kept fresh by WebSocket push (30s poll as fallback) |
| Incident Memory | Local technique/department/severity-overlap heuristic | Real `GET /ai/incidents/:id/similar` (the FAISS-equivalent Similarity Engine from Phase 5) |
| Policies | Static seed config, toggled client-side only | Real `GET /policies` + `PATCH /policies/:id/toggle`, audit-logged server-side, pushed live |
| Audit Logs | Session-scoped client-side log | Real `GET /audit-logs`, written server-side on sign-in/out, user (de)activation, policy toggles, ticket changes, pushed live |
| Reports | Aggregation over simulation/ticket state | Same aggregation, now over real incidents/tickets |
| User Management | Real `GET/PATCH /users` | Unchanged, now also audit-logged server-side |
| Settings | Real profile + connection test | Unchanged; Simulation Mode control now starts the real event generator described above |

## Security note

Refresh tokens are stored in `localStorage` (see `src/store/auth.store.ts`) —
there's no OS keychain to lean on in a browser SPA the way the Electron
employee app uses `safeStorage`. That's a real tradeoff: an XSS bug could
exfiltrate it. Hardening this for production means moving refresh-token
issuance to an httpOnly, Secure, SameSite cookie from the backend, which is
out of scope for this phase.

## Status: complete

Phases 8-13 delivered everything this section used to list as future work:
real device monitoring ingestion (`backend/src/modules/monitoring`), a
Docker Compose deployment stack (`infra/docker/`) with TLS termination and
proven multi-replica backend scaling, and this app's real backend/real
Simulation Mode split above is the final architecture, not an interim one.
See the root `README.md`'s roadmap and "Known Limitations" section for the
full picture — the only remaining open items are environment constraints
(no public domain for a real TLS cert, Python/Sysmon not installed in this
sandbox) rather than anything left to build here.
