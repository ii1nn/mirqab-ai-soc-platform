# Phase 4 — SOC Dashboard Application

**Scope:** the React web app used by IT/Security teams (`apps/soc-dashboard`),
plus a small, contained backend addition to make User Management real.

## What was built

### Backend (small addition)
- `UsersService.findAll()` / `setActive()`.
- `UsersController` — `GET /users`, `PATCH /users/:id/status`, both
  `@Roles(Role.ADMIN)`, reusing the RBAC infrastructure from Phase 2 as-is.

### SOC Dashboard — all 13 spec'd pages plus login
Dashboard, Live Alerts, Devices, Departments, Threat Map, Tickets, Analytics,
Reports, Incident Memory, Policies, Settings, User Management, Audit Logs,
The Citadel Live View.

### Simulation Mode — a real feature, not placeholder mock data
The platform spec explicitly requires a Simulation Mode (5 departments,
virtual devices, attack scenarios, real-time updates) as a first-class
feature. Since the backend has no Devices/Alerts/Incidents/Tickets modules
yet, `src/simulation/` implements that spec requirement directly:

- 5 departments, 15 virtual devices (`seedData.ts`).
- 5 attack scenarios — Phishing, Brute Force, Malware, Port Scan, Privilege
  Escalation — each tagged with a **real** MITRE ATT&CK technique ID
  (`mitre.ts`): T1566, T1110, T1204, T1046, T1068.
- A Zustand-based engine (`simulationEngine.ts`) that ticks every 7s while
  running, appending alerts and auto-escalating high/critical severity into
  incidents + tickets.

This one engine drives Dashboard, Live Alerts, Devices, Departments, Threat
Map (React Flow topology), Tickets, and Analytics — all genuinely reactive
to the same live state, not independently faked per page. It's always
labeled in the UI (topbar status pill, contextual empty states) and never
presented as real telemetry.

### Real, non-simulated features
- **Auth**: full login/refresh/logout/me integration against the Phase 2
  backend. `EMPLOYEE`-role accounts are explicitly rejected at login — this
  app is IT/Security only, per spec.
- **User Management**: genuinely backed by the new `/users` endpoints.
- **Audit Logs**: a real, session-scoped log of actions actually taken in
  the dashboard (sign-in/out, simulation start/stop, ticket reassignment,
  policy toggles, user deactivation) — not sample rows.
- **Settings**: real profile display, real simulation control, and a live
  "Test connection" check against `/auth/me` with measured latency.
- **Reports**: real aggregation (counts, average ticket resolution time)
  computed from current simulation state, exportable as JSON via a real
  client-side Blob download — no fabricated report content.
- **Recommended-fix-style linking**: Devices ↔ Live Alerts ↔ Departments are
  cross-linked via query params (`?departmentId=`, `?deviceId=`), not just
  visually similar pages.
- **Incident Memory**: incidents are real simulation output; "similar
  incidents" use a simplified, explicitly-labeled local scoring algorithm
  (shared technique/department/severity) as a stand-in for the FAISS-backed
  engine planned later.
- **Policies**: real toggle state (logged to Audit Logs), explicitly noted
  as draft configuration not yet persisted server-side.

## Design decisions worth flagging

- **Refresh token storage**: kept in `localStorage`, not an httpOnly cookie,
  because this is a plain browser SPA (unlike the Electron employee app,
  there's no OS keychain to lean on). This is a real security tradeoff,
  documented in `src/store/auth.store.ts` and `apps/soc-dashboard/README.md`
  — hardening it means adding cookie-based refresh issuance to the backend,
  which is out of scope here.
- **React Flow for Threat Map**, not a geographic map library — the spec's
  tech stack lists React Flow for "network topology" and doesn't include a
  mapping library, so Threat Map is a topology view (gateway → departments,
  animated red edges under active attack) rather than a world map.
- **Security Score has no dedicated Employee-app-style page here** — it's
  the org-wide gauge on the Dashboard, computed from unacknowledged alert
  severity across all departments (`lib/scoring.ts`), consistent with how
  Phase 3 treated the same concept per-device.

## Next

Phase 5+: replace Simulation Mode's data sources with real backend modules
(Devices, Departments, Alerts, Incidents, Tickets, Policies, AuditLogs),
wire the `websocket` module for real push updates instead of client-side
ticking, and connect the Claude + FAISS-backed AI engine (real MITRE
mapping already exists in the simulation and can carry over).
