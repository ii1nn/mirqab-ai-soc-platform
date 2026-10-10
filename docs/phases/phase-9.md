# Phase 9 — Redis-Backed Realtime Scaling + TLS

**Scope:** the three items Phase 8 left open — give the Redis container
Phase 8 provisioned an actual consumer, terminate TLS at the nginx layer
instead of serving plaintext HTTP, and get as far as this environment allows
toward running the Compose stack end-to-end.

## What was built

### Backend — Redis-backed `RealtimeGateway` scaling

- **`src/redis/redis.service.ts`** (new — the folder existed only as a
  `.gitkeep` stub since Phase 1). `RedisService.createAdapterClients()`
  returns a connected `ioredis` pub/sub client pair, or `null` if
  `REDIS_URL` is unset. Optional by design, same fallback philosophy as
  `ClaudeService`: no Redis configured means no cross-instance adapter, not
  a boot failure.
- **`RealtimeGateway` implements `OnGatewayInit`** — `afterInit(server)`
  asks `RedisService` for a client pair and, if given one, calls
  `server.adapter(createAdapter(pubClient, subClient))`
  (`@socket.io/redis-adapter`). Two separate connections are required
  because once a client issues `SUBSCRIBE`, the Redis protocol forbids any
  other command on that same connection — `pubClient.duplicate()` is how
  `RedisService` gets the second one.
- **Why this matters**: `server.emit()` only ever reached sockets connected
  to *that* backend process. Fine for one instance (all of Phase 7/8's
  testing), silently wrong the moment you run more than one replica behind
  a load balancer — a socket connected to replica B would never see an
  event a domain service on replica A emitted. The Redis adapter
  republishes every `server.emit()` through Redis pub/sub so every replica
  (each subscribed to the same channels) rebroadcasts it to its own
  connected sockets.
- **Tests**: `redis.service.spec.ts` (mocks `ioredis` — a real client would
  attempt an actual TCP connect in the test process) covers the configured/
  unconfigured branches and that `createAdapterClients()` returns a genuinely
  distinct pub/sub pair. `realtime.gateway.spec.ts` gained two `afterInit`
  cases: no adapter call when Redis isn't configured, `server.adapter()`
  called once when it is.

### Infra — TLS termination (`infra/docker/nginx/`)

- **`nginx.conf`** now has two server blocks: port 80 does nothing but
  `return 301 https://...` (kept reachable rather than closed, since a real
  CA's HTTP-01 challenge — e.g. certbot — needs plain port 80 open); port
  443 terminates TLS (`TLSv1.2`/`TLSv1.3` only) and carries the same
  `/api/v1/`, `/socket.io/`, `/` routing Phase 8 already had, now also
  forwarding `X-Forwarded-Proto` so the backend can tell it was reached over
  HTTPS if that ever matters to it.
- **`certs/generate-self-signed-cert.sh`** (new) — a one-line `openssl req
  -x509` self-signed cert generator for local/dev use, writing
  `fullchain.pem`/`privkey.pem` to the exact paths `nginx.conf` expects.
  Explicitly documented as dev-only in both the script's own header comment
  and `certs/README.md` — a real deployment replaces those two files with a
  certificate from an actual CA instead.
- **`certs/.gitignore`** (`*.pem`) plus a **new root `.gitignore`** — there
  wasn't one anywhere in the repo before this phase (git itself has only
  just become available in this environment — see the "Verification"
  section below). Generating a private key was the forcing function to
  finally add one, covering `node_modules/`, `dist/`, `.env`, `*.pem`, and
  the usual editor/OS noise, so the very next `git add` doesn't sweep any of
  that in by accident.
- **`docker-compose.yml`** — `nginx` now publishes `443:443` too and mounts
  `./nginx/certs` read-only; `backend` gets `REDIS_URL: redis://redis:6379`
  wired in (a no-op with this compose file's single backend replica — see
  the design decision below).

## Design decisions worth flagging

- **The Redis adapter is wired in but this Compose stack doesn't actually
  scale the backend.** `docker-compose.yml` still runs exactly one `backend`
  replica; `REDIS_URL` being set here makes the code path exercised (and
  ready for whenever a second replica exists) without claiming a capability
  this phase didn't build. Getting real multi-replica load balancing working
  would also require nginx's static `upstream backend { server backend:3000; }`
  to resolve more than one address, which plain open-source nginx doesn't do
  without a `resolver` directive and variable-based `proxy_pass` — flagged
  here rather than silently glossed over, since it's the part of "horizontal
  scaling" this phase didn't touch.
- **Self-signed cert, not a bundled real one.** A generator script (run once,
  locally) rather than a checked-in cert — a real cert either costs money
  (a purchased one) or requires domain ownership + a live HTTP-01/DNS-01
  challenge (Let's Encrypt), neither of which this environment can do for a
  `localhost` deployment. The port-80 redirect server block is deliberately
  left listening (not closed outright) specifically so swapping in certbot
  later doesn't also require an nginx.conf change.
- **Port 80 still exists — it redirects, it doesn't 404 or close.** Some
  guides drop the plain-HTTP listener entirely once TLS is in place; keeping
  it as a redirect-only endpoint is both the more common real-world pattern
  (clients that hardcode `http://` still get somewhere useful) and what a
  future certbot HTTP-01 challenge needs already sitting there.

## Verification

- `backend`: `npm install` (added `ioredis`, `@socket.io/redis-adapter`),
  `npm run build` (nest build) — clean, zero errors. `npm test` (jest) —
  `7 suites / 41 tests`, all passing (35 pre-existing + 6 new: 4
  `RedisService` cases, 2 new `RealtimeGateway.afterInit` cases).
- `infra/docker/docker-compose.yml`: validated with `docker compose config`
  against a copy of `.env.example` — renders correctly (also caught and
  removed an obsolete top-level `version:` key Compose v5 now warns about).
  This only exercises YAML/variable-interpolation correctness, not an actual
  build or boot.
- **Still not run end-to-end.** Docker itself is now installed in this
  environment (`docker --version` succeeds — it wasn't in Phase 8), but the
  Docker Desktop engine isn't currently running (`docker ps` fails to reach
  `npipe:////./pipe/dockerDesktopLinuxEngine`), so `docker compose up
  --build` has still not actually been executed here. Starting Docker
  Desktop is an interactive/GUI action on this machine, not something done
  silently from this environment. This is the one Phase 8 open item this
  phase did **not** close.

## Next

Start Docker Desktop and actually run `docker compose up --build` once,
end-to-end, to confirm the Phase 8/9 configs work as reviewed rather than
reviewed-correct. Beyond that: real multi-replica backend scaling (the nginx
`upstream`/`resolver` gap noted above), and a real (non-self-signed) TLS
cert for anything beyond local dev.
