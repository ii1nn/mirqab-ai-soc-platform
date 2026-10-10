# Phase 12 — Employee Desktop Connectivity to the Dockerized Stack

**Scope:** the two items Phase 11 left open — a real CA-issued TLS cert, and
Employee Desktop's relationship to `infra/docker`'s Compose stack.

## Real CA-issued TLS cert — still not achievable here

Unchanged from Phase 9/10/11's honest caveat: a real certificate (Let's
Encrypt or otherwise) needs either a publicly resolvable domain pointing at
this host (HTTP-01 challenge) or API access to a real DNS provider
(DNS-01). Neither exists in this sandboxed local environment — there is no
public domain and no internet-facing host to issue one for. The
self-signed dev cert (`infra/docker/nginx/certs/generate-self-signed-cert.sh`,
Phase 9) remains the correct answer for local dev; a real deployment on a
real domain swaps it in, as documented since Phase 9. Nothing new to build
here — restating this rather than silently dropping it.

## Employee Desktop ↔ Dockerized backend — solved without touching Electron's TLS trust

Phase 11 explicitly left this as an open decision between two options: add
dev-only Electron certificate-trust for the self-signed nginx cert, or
accept "point Employee Desktop at a bare `npm run start:dev` backend" as
permanent. A third option turned out to avoid the tradeoff entirely:

- **`infra/docker/docker-compose.yml`'s `backend` service now publishes
  port 3000** — but with no fixed host port (`ports: ['3000']`, not
  `['3000:3000']`). Docker assigns each replica its own random ephemeral
  host port for a bare container-port spec like this, which is exactly why
  it doesn't reintroduce the Phase 11 scaling conflict (Compose refuses to
  scale a service with a *fixed* published host port, since N replicas
  can't all bind the same one — a random-per-replica port has no such
  collision). Verified live: scaled to 3 backend replicas with this
  publish in place and confirmed no error, no port collision.
- **`infra/docker/.env`'s `CORS_ORIGIN`** now includes
  `http://localhost:5174` (Employee Desktop's Vite dev port, from its
  `vite.config.ts`) alongside `https://localhost` (the SOC Dashboard,
  through nginx) — both origins genuinely need backend CORS approval
  independently, since they're different actual origins hitting the same
  backend through different paths.
- **Employee Desktop's existing plain-HTTP expectation is exactly what
  this needed.** It already defaults to a bare, non-TLS
  `http://localhost:3000` backend for local dev (never went through nginx
  even before Docker existed) — pointing it at
  `http://localhost:<the-assigned-port>/api/v1` instead is a one-line env
  change, no code change, and no new trust relationship to establish.

**Verified for real**, not just configured: `scripts/test-employee-desktop-connectivity.ps1`
resolves the assigned port via `docker compose port backend 3000`, sends a
login request with `Origin: http://localhost:5174`, and confirms `200`,
`Access-Control-Allow-Origin: http://localhost:5174`, and a genuine access
token. Also re-confirmed scaling still works with the port publish present
(`docker compose up -d --scale backend=3`, then `docker compose port
backend 3000` still resolves cleanly, one entry per replica).

### Why not just add Electron cert-trust instead?

Considered and deliberately not done. `app.on('certificate-error', ...)`
(or a blanket `ignore-certificate-errors` command-line switch) is the
standard way to make an Electron app accept a self-signed cert, but doing
it safely means gating it strictly to development builds and ideally
pinning to the specific cert's fingerprint rather than disabling
validation outright — and a self-signed dev cert's fingerprint changes
every time `generate-self-signed-cert.sh` runs, so a hardcoded pin isn't
practical without extra plumbing (reading an expected fingerprint from an
env var, etc.). The random-port approach above gets Employee Desktop
talking to the exact same containerized backend (same Postgres data, same
seeded admin, same Redis-backed realtime layer) with zero new code in
`electron/main.ts` and zero risk of a certificate-validation bypass ever
leaking into a production build. Simpler and safer won here.

## Verification

- Live 3-replica scaling test repeated with the port publish present — no
  conflict, `docker compose port backend 3000` resolves correctly.
- `scripts/test-employee-desktop-connectivity.ps1` — `200`, correct CORS
  header, real access token, run from the repo root against the live stack.
- No backend or Employee Desktop application code changed this phase —
  only `infra/docker/docker-compose.yml`, `infra/docker/.env(.example)`,
  and documentation.

## Next

Nothing currently blocking — both items Phase 11 left open are now either
resolved (Employee Desktop connectivity) or restated as a standing,
environment-imposed limitation (real TLS cert) rather than active work.
Future phases would be new scope: e.g. the device-monitoring agents in
`infra/monitoring/` haven't been run against a real Wazuh/Suricata/Sysmon
deployment, only documented as reference configs (Phase 8).
