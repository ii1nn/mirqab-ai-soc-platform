# Phase 6 — Wire the Dashboard to the Real Backend

**Scope:** close the loop between the SOC Dashboard and the AI engine. Build
the domain modules the Prisma schema was still missing (Departments, Devices,
Policies, AuditLogs, Tickets), make `Incident`'s `departmentId`/`deviceId`
real relations, and rewire every SOC Dashboard page off Phase 4's client-side
Simulation Mode onto real backend data. No Employee Desktop changes.

## What was built

### Backend

- **Prisma schema** — new `Department`, `Device`, `Policy`, `AuditLog`
  models. `Incident.departmentId`/`deviceId` became real relations (`@relation`
  + `@@index`) instead of the plain optional strings Phase 5 used as a
  placeholder. `Ticket` gained denormalized `departmentId`/`deviceId` (plain
  strings copied from the parent incident at creation time, not FK relations
  — a ticket is a point-in-time record of where an incident lived, not a live
  link to a device that could later be reassigned or deleted).
- **`departments/`, `devices/`, `policies/`, `audit-logs/`, `tickets/`
  modules** — same NestJS module/service/controller/DTO shape as every prior
  module. Highlights:
  - `DevicesService.withComputedStatus()` derives each device's `status`
    (`ONLINE`/`AT_RISK`), `currentScore`, and `activeIncidentCount` at query
    time from its OPEN incidents created in the last 5 minutes — nothing
    persisted, same approach Phase 4 used client-side, now authoritative
    server-side.
  - `PoliciesService.toggle()` and `TicketsService.updateStatus()`/`reassign()`
    write to the new `AuditLogsService` — every meaningful state change now
    has a real audit trail row, not the session-scoped Zustand log Phase 4
    shipped as a placeholder.
  - `AuthService` and `UsersController` (sign-in/out, user
    deactivation/reactivation) now log through the same `AuditLogsService`
    instead of leaving audit logging entirely to the frontend.
- **`AiService.analyzeLog()`** — no longer accepts `departmentId` directly;
  it looks up the `Device` by `deviceId` and derives `departmentId` from the
  device relation (a caller can't claim a department a device doesn't belong
  to). Ticket creation copies both IDs onto the `Ticket`. Added
  `PATCH /ai/incidents/:id/status` so the dashboard can acknowledge/resolve
  incidents against the real pipeline.
- **Seed script rewrite** — seeds the same 5 departments / 15 devices / 6
  policies the Phase 4 frontend used to hardcode, via `upsert`, so the
  dashboard's UI looks identical on first run even though the data now comes
  from Postgres.

### Frontend (SOC Dashboard)

- **Adapter layer** (`services/backend-types.ts` + `services/adapters.ts`) —
  the backend's Prisma enums are `UPPER_SNAKE_CASE` (`Severity.HIGH`,
  `TicketStatus.IN_PROGRESS`); Phase 4's components expect lowercase/hyphenated
  strings (`'high'`, `'in-progress'`). A small set of `fromBackendX`/
  `toBackendX` converters at the service boundary absorbs that mismatch, so
  the 14 page components below needed almost no changes to their filter/
  display logic.
- **New services + hooks** for departments, devices, incidents, tickets,
  policies, audit logs — each a thin fetch wrapper + adapter, exposed via a
  TanStack React Query hook with `refetchInterval` polling (5–10s depending
  on resource). Real-time-feeling updates come entirely from polling, not
  manual cache invalidation — the Zustand simulation store has no reference
  to the QueryClient, and polling is simpler than wiring one through.
- **Simulation Mode, reinvented.** It no longer holds any data itself. It's
  now a timer that, every 8s, picks a random virtual device + attack
  scenario, builds a realistic log excerpt phrased to match the backend's
  MITRE keyword matcher, and calls the real `POST /ai/analyze`. Every alert,
  incident, ticket, and notification it produces is genuinely persisted —
  Simulation Mode is now an event *generator* pointed at the real pipeline,
  not a separate fake data path. (No `ANTHROPIC_API_KEY` is configured in
  this environment, so what actually runs end-to-end today is the rule-based
  fallback path from Phase 5 — which is exactly the scenario that fallback
  was built for.)
- **All 14 pages rewritten** off `useSimulationStore` onto the new hooks:
  Dashboard, Live Alerts, Devices, Departments, Threat Map, Tickets,
  Analytics, Incident Memory, Policies, Audit Logs, Settings, Reports, The
  Citadel Live View, User Management. Incident Memory's "similar incidents"
  now calls the real `GET /ai/incidents/:id/similar` (the actual FAISS-
  equivalent engine from Phase 5) instead of Phase 4's local
  technique/department/severity-overlap stand-in. Policies and Audit Logs
  lost their "not yet persisted" / "session-scoped" disclaimers because
  they're no longer true.
- **Deleted** (grep-verified zero remaining importers first):
  `simulation/seedData.ts`, `simulation/mitre.ts`, `lib/deviceState.ts`,
  `store/policies.store.ts`, `store/audit-log.store.ts`,
  `features/incident-memory/similarity.ts`,
  `components/ui/MockBadge.tsx`.

## Design decisions worth flagging

- **`AlertRecord` kept its name, changed its shape.** Phase 4 had separate
  `AlertRecord`/`IncidentRecord` types (an alert escalates into an incident
  once severity crosses a threshold). The real backend only has one
  `Incident` model — every classified event, any severity. Rather than
  rename every prop/import across widgets and pages, `AlertRecord` was
  redefined to match the real `Incident` shape, with `acknowledged` derived
  as `status !== 'open'` so `lib/scoring.ts` needed zero changes.
- **Ticket `departmentId`/`deviceId` are denormalized, not FK relations** —
  intentional. A ticket should reflect where the incident was *when it was
  created*; it shouldn't silently change or break if the device is later
  reassigned to a different department or removed.
- **`AiService.analyzeLog()` derives `departmentId` server-side from the
  device relation** rather than trusting a client-supplied value — closes a
  trust boundary that didn't matter when the field was just a decorative
  string, but matters once it's a real relation other queries join on.

## Errors found and fixed while verifying this phase

Neither of these was a regression from Phase 6's own edits — both were
latent issues never caught because no build had actually been run in any
prior phase:

1. **`@anthropic-ai/sdk` was pinned to `^0.32.0`**, far too old for the
   `output_config.format` / `cache_control` API shapes Phase 5's
   `claude.service.ts` was written against (`0.32.x` predates both). Bumped
   to `^0.115.0` in `backend/package.json`; this resolved all 3
   `claude.service.ts` compile errors.
2. **`user.entity.ts` had 9 fields with no initializer** under
   `strict: true` — the constructor populates them via
   `Object.assign(this, partial)`, which TypeScript can't statically verify
   satisfies every field. Added definite-assignment assertions (`!`) to each
   field, with a comment explaining why that's correct here rather than a
   workaround.
3. **`AnalyticsPage.tsx`'s "alerts by department" chart** grouped incidents
   into a `Map<string, number>` keyed directly by `alert.departmentId`,
   which is `string | null` — a device with no department would fail to
   compile against the `Map<string, number>` key type. Fixed by falling
   back to an `'unassigned'` sentinel key, displayed as "Unassigned".

## Verification

- `backend`: `npm run build` (nest build) — clean, zero errors.
  `npm test` (jest) — `3 suites / 17 tests`, all passing.
- `apps/soc-dashboard`: `npm run build` (`tsc -b && vite build`) — clean,
  zero errors. (No dashboard test suite exists yet — Phase 4/6 never added
  `*.spec.ts`/`*.test.ts` files for this app, unlike the backend.)

## Next

Phase 7+: wire the `websocket` module for real push updates (replacing
polling), device monitoring agent ingestion (Wazuh/Sysmon/Suricata) feeding
real telemetry into `/ai/analyze` instead of Simulation Mode, and a Docker
Compose deployment stack.
