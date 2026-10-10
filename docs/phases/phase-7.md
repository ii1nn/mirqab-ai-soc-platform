# Phase 7 — Real-Time WebSocket Layer

**Scope:** replace the SOC Dashboard's reliance on React Query polling as
its primary update mechanism with real push updates over a Socket.IO
gateway. No Employee Desktop changes — the gateway is dashboard-only, same
as every domain module before it.

## What was built

### Backend

- **`modules/websocket/`** — `RealtimeGateway` (`@nestjs/websockets` +
  `@nestjs/platform-socket.io`, Socket.IO namespace `/realtime`).
  `handleConnection()` authenticates the handshake by verifying the JWT
  access token (same `jwt.accessSecret` the REST API's `JwtStrategy` uses),
  looking the user up, and disconnecting immediately if the token is
  missing/invalid, the user is inactive, or the role is `EMPLOYEE` — this
  gateway is a SOC Dashboard concern only, the same boundary every REST
  domain endpoint already enforces.
- **`EventEmitter2` (`@nestjs/event-emitter`) as the decoupling layer.**
  `AiService`, `TicketsService`, `PoliciesService`, and `AuditLogsService`
  emit domain events (`incident.created`, `incident.updated`,
  `ticket.created`, `ticket.updated`, `policy.updated`,
  `audit-log.created`) after their Prisma writes succeed —
  `modules/websocket/events.ts` is the single shared source of event names
  and payload types. `RealtimeGateway` is the only listener
  (`@OnEvent(...)` handlers that `server.emit()` the same event to every
  connected socket). None of the emitting services import or know about the
  WebSocket module — they only depend on `EventEmitter2`, which
  `EventEmitterModule.forRoot()` (registered once in `AppModule`, internally
  `@Global()`) makes injectable anywhere without importing it again.
- **Tests**: `realtime.gateway.spec.ts` covers connection auth (valid
  dashboard role accepted, missing/invalid token rejected, `EMPLOYEE` role
  rejected, deactivated user rejected) and event broadcasting
  (`server.emit` called with the right event name and payload).
  `ai.service.spec.ts` updated with an `EventEmitter2` mock provider.

### Frontend (SOC Dashboard)

- **`lib/socket.ts`** — a lazily-created, shared `socket.io-client`
  instance pointed at the API origin's `/realtime` namespace (derived from
  `VITE_API_BASE_URL` by stripping the `/api/v1` REST prefix — the gateway
  isn't under that prefix, since Socket.IO namespaces are a separate
  concept from HTTP routes). `auth` is passed as a callback function, not a
  fixed object, so every reconnect attempt reads the *current* access token
  from `useAuthStore` — it survives the axios interceptor's token refresh
  without any manual resync.
- **`hooks/useRealtimeSync.ts`** — connects the socket once
  `useAuthStore`'s status is `'authenticated'`, disconnects on logout/
  unmount. Every event handler does exactly one thing:
  `queryClient.invalidateQueries()` for the relevant key(s) — it never
  writes server data into the cache directly. This keeps the REST
  adapters (`services/adapters.ts`) as the single source of truth for how
  backend responses are shaped; the socket is purely a "something changed,
  refetch" signal. An `incident.created`/`incident.updated` event also
  invalidates the `devices` cache, since `DevicesService.withComputedStatus()`
  derives device status/score from open incidents server-side — there's no
  separate device-specific socket event needed.
- Mounted via a single `useRealtimeSync()` call in `AppShell` (the
  authenticated route wrapper), so it's active exactly when a dashboard
  session is active and torn down when the shell unmounts.
- **Polling demoted to a safety net.** Every `refetchInterval` (`incidents`,
  `tickets`, `devices`, `audit-logs`) moved from 5–10s to 30s, and
  `policies` — which had none — gained one. Push is now the primary update
  path; polling only covers a missed event or a reconnect gap.

## Design decisions worth flagging

- **`EventEmitter2`, not a direct gateway dependency.** The alternative —
  injecting `RealtimeGateway` straight into `AiService`/`TicketsService`/
  `PoliciesService`/`AuditLogsService` — would work, but it would make four
  unrelated domain modules import `WebsocketModule` and know a gateway
  exists at all. The event-emitter indirection means those services stay
  focused on their own domain logic; the WebSocket layer is an
  implementation detail of "how the dashboard finds out something changed,"
  swappable later (e.g. for Redis pub/sub across multiple backend
  instances) without touching a single domain service.
- **Socket events carry no adapted domain data, only a refetch signal.**
  Sending raw Prisma-shaped payloads (`Incident`, `Ticket`, `Policy`,
  `AuditLog`) over the socket and writing them straight into the React
  Query cache would mean either duplicating `services/adapters.ts`'s
  enum-casing conversion on the socket path, or leaking backend-shaped data
  into components that expect the frontend's domain types. Invalidating and
  letting the existing REST fetch (already adapted) run instead avoids that
  duplication entirely, at the cost of one extra round trip per event — a
  reasonable tradeoff at SOC-dashboard data volumes.
- **Polling wasn't removed, only slowed down.** A dropped WebSocket
  connection (network blip, tab backgrounded, browser sleep/resume) would
  silently stop updates forever if push were the *only* mechanism. Keeping
  a 30s poll means the dashboard self-heals within half a minute even if
  the socket never reconnects cleanly.

## Verification

- `backend`: `npm run build` (nest build) — clean, zero errors.
  `npm test` (jest) — `4 suites / 25 tests`, all passing (17 pre-existing +
  8 new gateway tests).
- `apps/soc-dashboard`: `npm run build` (`tsc -b && vite build`) — clean,
  zero errors.

## Next

Phase 8+: device monitoring agent ingestion (Wazuh/Sysmon/Suricata) feeding
real telemetry into `/ai/analyze` instead of Simulation Mode being the only
event source, and a Docker Compose deployment stack tying the backend,
Postgres, Redis, and both frontends together.
