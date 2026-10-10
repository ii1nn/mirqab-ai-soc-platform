# Phase 10 — Actually Running the Stack End-to-End

**Scope:** the one item Phase 9 explicitly left open — start Docker, bring
up the full `infra/docker/docker-compose.yml` stack for real, and fix
whatever that surfaces. It surfaced four real, previously-hidden bugs, none
of which `npm run build` / `npm test` could ever have caught, since none of
them touch TypeScript compilation or unit-testable logic — every one only
exists at actual container-boot time.

## What was found and fixed

1. **Prisma's schema engine couldn't parse its own response on Alpine.**
   `Error: Could not parse schema engine response: SyntaxError: Unexpected
   token 'E', "Error load"...` — Alpine's base image ships neither `libssl`
   nor its headers, and Prisma's engine binary selection depends on
   detecting an OpenSSL version at `prisma generate` time. Fixed by adding
   `RUN apk add --no-cache openssl` to both Dockerfile stages (build *and*
   runtime — the generated binary needs the library present at runtime too,
   not just when it was selected).
2. **No Prisma migration ever existed anywhere in this repo.** Every
   previous phase's "verification" was `npm run build` / `npm test` — never
   `prisma migrate dev` against a live Postgres — so nothing had ever
   generated a `migrations/` folder; only a `.gitkeep` sat there since
   Phase 1. `docker-entrypoint.sh`'s `prisma migrate deploy` (which only
   *applies* existing migrations, it never creates them) had nothing to
   apply, so `users`/`incidents`/every other table never got created and
   the seed script failed with `P2021: The table "public.users" does not
   exist`. Fixed by generating the real initial migration — `npx prisma
   migrate dev --name init` run inside a throwaway container with
   `backend/src/database/prisma` bind-mounted from the host (the first
   attempt, without the bind mount, generated the migration inside a
   `--rm`'d container and lost it the moment the container exited — redone
   properly the second time). `backend/src/database/prisma/migrations/20260727120314_init/`
   is now checked into the repo.
3. **The Dockerfile's runtime stage never copied `migrations/` into the
   image at all** — only `schema.prisma` had an explicit `COPY`. So even
   after fixing #2, `migrate deploy` inside the container still reported
   "No migration found in prisma/migrations", because the folder simply
   didn't exist in that image, regardless of what was checked into the
   repo. Fixed with an explicit `COPY src/database/prisma/migrations
   ./src/database/prisma/migrations` in the runtime stage.
4. **Joi's `.optional()` rejects a present-but-empty string** — distinct
   from the variable being unset entirely. Both `.env.example` files ship
   `ANTHROPIC_API_KEY=` and `REDIS_URL=` (present, empty) for exactly the
   "not configured" case `ClaudeService`/`RedisService` already handle
   gracefully downstream — but `docker-compose.yml` passes that empty
   string through as a real (if empty) environment variable, and
   `Joi.string().optional()` treats an empty string as a validation
   failure: `Config validation error: "ANTHROPIC_API_KEY" is not allowed to
   be empty`. This would have hit anyone running the backend locally too,
   the moment they copied `.env.example` to `.env` verbatim without
   deleting that line — it just never got exercised because nobody had
   actually done that yet. Fixed with `.allow('')` on both fields in
   `env.validation.ts`.
5. **`RealtimeGateway.afterInit`: `TypeError: server.adapter is not a
   function`.** `@nestjs/websockets` types the injected object as `Server`
   regardless, but because this gateway declares `namespace: 'realtime'`,
   what Nest actually hands `afterInit` (and `@WebSocketServer()`) is the
   Socket.IO `Namespace` instance — `Namespace` has no `.adapter()` setter
   of its own (only the root `Server` does); `namespace.server` is the way
   back to it. This is exactly the kind of gap a mocked unit test can't
   catch: `realtime.gateway.spec.ts`'s existing mock was a plain
   `{ adapter: jest.fn(), emit: jest.fn() }` object, which happily accepted
   the wrong-shaped call. Fixed the gateway to call
   `namespace.server.adapter(...)` and updated the test mock to actually
   match a `Namespace`'s shape (`{ server: { adapter: jest.fn() }, emit:
   jest.fn() }`) so a future regression here would fail the test, not just
   a real container.

## What was verified, for real

- Docker Desktop's engine (installed but not running as of Phase 9) was
  started; `docker compose config` was re-validated, then `docker compose
  up --build` was run repeatedly against the fixes above until the backend
  container stopped crash-looping and logged `Nest application successfully
  started`.
- The dev TLS cert (`infra/docker/nginx/certs/{fullchain,privkey}.pem`) was
  generated for real — via a throwaway `alpine/openssl` container rather
  than `generate-self-signed-cert.sh` directly, since this Windows host has
  neither `openssl` nor a POSIX shell on `PATH` (Git wasn't bundled with
  one either). The script itself is unchanged and still the documented path
  for a host that does have `openssl`/`sh`.
- `GET https://localhost/` (through nginx, self-signed cert) returns the
  built SOC Dashboard's `index.html` — confirms the `/` → `soc-dashboard`
  proxy path and TLS termination both work.
- `POST https://localhost/api/v1/auth/login` with the seeded admin
  credentials returns `200` with a real access token — confirms
  `/api/v1/` → `backend` → Postgres → JWT issuance works end-to-end through
  the whole chain, not just that each container independently reports
  healthy. This check is now `scripts/test-login.ps1` (credentials read
  from `MIRQAB_ADMIN_EMAIL`/`MIRQAB_ADMIN_PASSWORD` env vars, falling back
  to the documented seed defaults), so it can be re-run after future
  changes instead of being one-off inline commands.
- Backend logs confirm `RealtimeGateway using the Redis adapter for
  cross-instance broadcast` — the Phase 9 Redis wiring is confirmed
  actually engaging, not just unit-tested in isolation.
- `backend`: `npm run build` + `npm test` re-run after the `env.validation.ts`
  and `realtime.gateway.ts` fixes — still `7 suites / 41 tests`, all passing.

## Design decisions worth flagging

- **The lost first migration attempt was a process mistake, not a design
  choice** — worth stating plainly rather than glossing over: generating a
  migration inside a `docker compose run --rm` container without mounting
  the target folder from the host writes the file somewhere that vanishes
  the instant the container is removed. The fix (bind-mount the specific
  folder for that one-off command) is now the documented approach if this
  ever needs to happen again (e.g. a future migration for a schema change).
- **The dev cert was generated via Docker itself, not a host install.**
  Rather than requiring `openssl`/`git bash`/WSL specifically on whatever
  machine runs this, `docker run --rm -v ...:/certs alpine/openssl req
  -x509 ...` uses the one dependency this whole phase already requires
  anyway (Docker). `certs/generate-self-signed-cert.sh` stays as the
  documented in-repo script for a host that already has `openssl`; this
  phase's actual generation used the container equivalent instead, and
  that's a reasonable alternative worth documenting rather than treating as
  a deviation.

## Verification

- Full stack (`postgres`, `redis`, `backend`, `soc-dashboard`, `nginx`) up
  and stable via `docker compose ps` — no container restarting.
- `backend`: `npm run build` (nest build) — clean. `npm test` (jest) —
  `7 suites / 41 tests`, all passing (unchanged count from Phase 9 — this
  phase fixed runtime/deployment bugs, not added new test-covered logic,
  aside from correcting the `afterInit` mock shape).
- Real HTTP traffic through the actual public entrypoint (`scripts/test-login.ps1`),
  not just container health checks.

## Next

Phase 11+: multi-replica backend scaling (the nginx `upstream`/`resolver`
gap noted in Phase 9 is still open), a real CA-issued TLS cert for anything
beyond local dev, and running `apps/employee-desktop` against this stack to
confirm the full three-app system (backend + SOC Dashboard + Employee
Desktop) works together, not just the two web-facing pieces this Compose
stack containerizes.
