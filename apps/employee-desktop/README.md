# Mirqab Employee (Electron + React)

The endpoint agent installed on employee devices.

## Setup

```bash
cp .env.example .env
npm install
npm run dev      # launches Vite + Electron together
```

Requires the backend from `../../backend` running locally (`/auth/login` etc.)
at the URL configured in `VITE_API_BASE_URL`.

## Architecture

- **`electron/main.ts`** — creates the frameless `BrowserWindow`
  (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`),
  enforces a single instance, and registers all IPC handlers.
- **`electron/preload.ts`** — the only bridge between renderer and OS,
  exposed as `window.mirqab` via `contextBridge`. The renderer never gets
  direct `ipcRenderer`/Node access.
- **`electron/ipc/device.ipc.ts`** — real device telemetry: CPU load
  (sampled via `os.cpus()` deltas, since `os.loadavg()` is always `[0,0,0]`
  on Windows), memory, disks, Windows Defender status, firewall profile
  status, top processes, and installed applications — all via `os` or
  fixed (never user-built) PowerShell commands, degrading to empty/"unknown"
  results on non-Windows or when a cmdlet is unavailable.
- **`electron/ipc/auth.ipc.ts`** — the refresh token is the only credential
  persisted on disk, encrypted with `safeStorage` (Windows DPAPI). Access
  tokens live in renderer memory only (`src/store/auth.store.ts`), never on
  disk.
- **`src/services/api-client.ts`** — axios instance that attaches the access
  token and auto-refreshes once on a 401 before retrying, backed by the
  Phase 2 backend auth contract.

## What's real vs. mock

Per the "no fake data unless clearly marked" rule, this app is honest about
what it can and can't observe:

| Feature | Data source |
|---|---|
| Device Health / Device Info | **Real** — live OS metrics via IPC |
| Security Score | **Real** — deterministic rubric over Defender/firewall/disk/CPU signals (`src/features/security-score/scoreEngine.ts`) |
| Recommended Fixes | **Real** — derived directly from the failing security-score checks |
| Incident History | **Mixed** — locally-detected issues are real; a couple of sample rows (tagged "Sample data") illustrate incident types a single device can't detect alone |
| AI Scan | **Mock, but not because the backend lacks the capability** — this app tries `POST /ai/scan`, which was never actually built; the real AI engine lives at `POST /ai/analyze` (`backend/src/modules/ai`, since Phase 5) instead. This app's AI Scan feature was never updated to call it, so it always falls back to a local heuristic process-name check, clearly tagged "Sample data" in the UI. Wiring it to the real endpoint is a real client-side gap, not a missing backend feature — and not something any of the 13 completed phases scoped or touched. |

## Status: complete (with one known, pre-existing client-side gap)

This app's own 13-phase scope (Phase 3, plus the Phase 11/12 fixes below)
is done. The one item still mock-tagged — AI Scan — isn't blocked on
anything backend-side; see the table above. Wiring it to `POST /ai/analyze`
would be new scope, not a completion of existing work.

## Build note (Phase 11)

`npm install` had never actually been run in this checkout before Phase 11 —
doing so for the first time surfaced a real `tsc` failure in
`electron/ipc/device.ipc.ts` (a TypeScript generic-inference gap in
`asArray(parsePowerShellJson<T>(...))` calls, silently inferring `unknown`
instead of `T`). Fixed by making the type argument explicit at each call
site; `npm run build` is clean now. See `docs/phases/phase-11.md`.

This app's default `VITE_API_BASE_URL` (a bare `http://localhost:3000`
backend) points at a plain `npm run start:dev` backend, same as always. See
Phase 12 below for pointing it at the Dockerized backend instead.

## Connecting to the Dockerized backend (Phase 12)

`infra/docker/docker-compose.yml`'s `backend` service publishes container
port 3000 to a random host port (not a fixed one — a fixed `3000:3000`
mapping would break `docker compose up --scale backend=N`, since Compose
refuses to scale a service with a published fixed host port). Find the
assigned port with `docker compose port backend 3000`, then set this app's
`VITE_API_BASE_URL` to `http://localhost:<that port>/api/v1` — see the
comment in `.env.example`. `infra/docker/.env`'s `CORS_ORIGIN` already
includes `http://localhost:5174` (this app's Vite dev port) for exactly
this. Verified end-to-end with `scripts/test-employee-desktop-connectivity.ps1`
(from the repo root) — a real login through this path returns `200` with a
matching `Access-Control-Allow-Origin` header and a genuine access token.

This intentionally goes over plain HTTP, not through nginx/TLS — this app
was never pointed at a TLS-terminated backend even in its non-Docker
workflow, and adding Electron cert-trust for the self-signed dev cert
(Phase 9) would mean adding a dev-only certificate-validation override to
`electron/main.ts`, a change that's easy to get wrong in a way that
weakens the production build's TLS validation too. Not done, and flagged
rather than silently skipped — see `docs/phases/phase-12.md`.
