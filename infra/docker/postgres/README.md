# infra/docker/postgres

No custom init scripts here — `docker-entrypoint.sh` (in `backend/`) runs
`prisma migrate deploy` against a stock `postgres:16-alpine` on every backend
container boot, so schema management stays in the Prisma migrations already
tracked in `backend/src/database/prisma/migrations`, not duplicated as raw SQL
here.
