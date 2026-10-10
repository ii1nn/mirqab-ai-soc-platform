#!/bin/sh
set -e

./node_modules/.bin/prisma migrate deploy --schema=src/database/prisma/schema.prisma

# seed.ts is upsert-based (see src/database/seed/seed.ts) — safe to run on
# every boot, not just the first, so there's no separate "first run" flag to manage.
node dist/database/seed/seed.js

exec node dist/main.js
