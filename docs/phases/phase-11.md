# Phase 11 — Multi-Replica Backend Scaling + Employee Desktop Build

**Scope:** the remaining Phase 9/10 open items — make nginx actually
distribute traffic across more than one `backend` replica (not just avoid
erroring with one), and check `apps/employee-desktop` against this stack.
Both were verified for real, not just reviewed.

## Multi-replica backend scaling — verified live

`infra/docker/nginx/nginx.conf`'s `upstream backend { server backend:3000; }`
block (Phase 8) resolves that hostname once, at nginx startup — fine for
exactly one replica, silently wrong for more, since only whichever single
replica existed at that moment would ever receive traffic. Fixed:

- Added `resolver 127.0.0.11 valid=10s;` — Docker's embedded DNS server,
  reachable from any container on a compose-created network.
- Replaced the static `upstream backend {...}` block with
  `set $backend_upstream backend:3000;` and `proxy_pass
  http://$backend_upstream;` in both the `/api/v1/` and `/socket.io/`
  locations. A *variable* in `proxy_pass` is what forces nginx to re-resolve
  the hostname per-request via the configured `resolver`, instead of once
  at config load — the actual mechanism that makes this work, not just the
  presence of a `resolver` directive on its own.
- `soc-dashboard`'s `upstream` block is untouched — it only ever runs one
  replica, so the original static-resolution behavior is correct there.

**Verified, not just configured:** scaled the live stack to 3 backend
replicas (`docker compose up -d --scale backend=3`), added
`$upstream_addr` to nginx's access log format, fired 15 requests through
`scripts/test-scaling.ps1`, and confirmed via `docker compose logs nginx`
that requests actually landed on at least 3 distinct container IPs
(`172.18.0.7`, `172.18.0.8`, `172.18.0.4` in this run), all `200`. Scaled
back down to 1 replica afterward — that's the compose file's default
posture, and the fix is what matters, not leaving it scaled.

## Employee Desktop — a real, previously-undiscovered build failure

`npm install` had never been run for `apps/employee-desktop` in this
checkout at all (no `node_modules`) — meaning `npm run build` had never
actually been executed here either, despite the app being built out fully
in Phase 3. Once actually run:

```
electron/ipc/device.ipc.ts(96,21): error TS18046: 'row' is of type 'unknown'.
```
— 14 instances of the same error, at every `rows.map((row) => ...)` call
site in that file (`getDisks`, `getFirewallStatus`, the process list and
installed-apps IPC handlers).

**Root cause:** `asArray<T>(value: T | T[] | null): T[]` (in
`electron/ipc/powershell.util.ts`) takes a naked union type parameter
(`T | T[]`). TypeScript's inference for that shape, given a call like
`asArray(parsePowerShellJson<Record<string, unknown>>(raw))` — where the
type argument is supplied on the *inner* call but not the outer one — fails
to propagate `Record<string, unknown>` through to `T`, and silently falls
back to inferring `T` as `unknown` rather than erroring on the `asArray`
call itself. The failure only surfaces one call deeper, at first property
access on `row` inside `.map()`. Confirmed by fixing one call site first
(adding an explicit type argument) and observing only that call site's
errors disappear before applying the same fix to the other three.

**Fix:** made the type argument explicit at all four call sites —
`asArray<Record<string, unknown>>(parsePowerShellJson<Record<string,
unknown>>(raw))` — rather than relying on inference through the nested
generic call. `npm run build` (`tsc -b && vite build`) is now clean.

## Employee Desktop vs. this Compose stack — what's actually connected, what isn't

- `apps/employee-desktop/.env.example` defaults to
  `VITE_API_BASE_URL=http://localhost:3000/api/v1` — a bare, un-proxied
  backend, matching the already-documented non-Docker `npm run start:dev`
  workflow (`backend/README.md`: "The API listens on
  `http://localhost:3000/api/v1` by default").
- This Compose stack's `backend` service does **not** publish port 3000 to
  the host — deliberately: adding a fixed host-port mapping would break
  `docker compose up --scale backend=N` outright (Compose refuses to scale
  a service with a published host port, since N replicas can't all bind the
  same host port). The whole point of the nginx fix above was to make
  scaling actually work; punching a direct host port through for Employee
  Desktop's convenience would have undone it.
- The architecturally-consistent alternative — point Employee Desktop at
  the same `https://localhost/api/v1` entrypoint the SOC Dashboard already
  uses — hits the self-signed dev cert (Phase 9): Chromium (Electron's
  renderer) rejects it exactly like a browser would, and making Electron's
  main process trust it would mean adding a dev-only certificate-validation
  override to `electron/main.ts`, which is the kind of change that's easy
  to get wrong in a way that weakens the production build's TLS validation
  too. That wasn't done this phase — it's flagged here rather than
  papered over with an unstated assumption.
- **Net effect:** Employee Desktop's existing local-dev path (a bare
  `npm run start:dev` backend, no Docker) still works exactly as documented
  and is unaffected by anything in this phase. Running it *against the
  containerized stack specifically* remains open — see Next.
- The Electron GUI itself was not launched in this session — that opens an
  actual window on the host's desktop, which wasn't asked for and seemed
  worth flagging rather than doing unprompted.

## Verification

- `infra/docker`: live 3-replica scaling test as described above —
  `docker compose logs nginx` shows requests landing on 3 distinct
  `$upstream_addr` values, all `200`.
- `apps/employee-desktop`: `npm install` (571 packages, none previously
  installed in this checkout) + `npm run build` (`tsc -b && vite build`) —
  now clean, zero errors.
- `backend`: unaffected by this phase's changes — not re-run.

## Next

A real (non-self-signed) TLS cert for anything beyond local dev (open since
Phase 9), and either exposing the backend to Employee Desktop through the
same nginx/TLS path the dashboard uses (requiring the Electron cert-trust
work flagged above) or accepting that Employee Desktop's containerized-stack
story stays "point it at a bare `npm run start:dev` backend" indefinitely,
which is a legitimate choice worth making explicitly rather than by default.
