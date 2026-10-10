# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Prisma's engine binaries are picked per-OpenSSL-version at `prisma generate`
# time — Alpine's base image ships neither libssl nor its headers by default,
# so without this, prisma either fetches the wrong engine variant for the
# runtime image or fails outright ("Could not parse schema engine response").
RUN apk add --no-cache openssl

COPY package*.json ./
COPY src/database/prisma/schema.prisma ./src/database/prisma/schema.prisma
RUN npm ci

COPY . .
RUN npx prisma generate --schema=src/database/prisma/schema.prisma
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Same reason as the build stage — the engine binary copied over via
# node_modules below needs libssl actually present at runtime, not just at
# generate time.
RUN apk add --no-cache openssl

COPY package*.json ./
# schema.prisma has to exist before `npm ci` runs — @prisma/client's own
# postinstall hook looks for it to generate the query engine, and silently
# leaves an uninitialized client behind if it can't find one (this was
# missing on the first pass at this stage and broke `prisma migrate
# deploy`/the seed script at boot with "did not initialize yet").
COPY src/database/prisma/schema.prisma ./src/database/prisma/schema.prisma
# Fresh production-only install rather than copying the build stage's
# node_modules wholesale — `prisma` (needed at boot for `prisma migrate
# deploy`, see docker-entrypoint.sh) now lives in "dependencies" precisely so
# it survives --omit=dev here. This drops @nestjs/cli, @angular-devkit/*,
# webpack, jest, eslint, typescript, etc. — real build/test tooling with no
# runtime purpose — out of the shipped image entirely, still with no network
# access needed at container *start* (only at this build step, same as the
# build stage already required).
RUN npm ci --omit=dev
# Explicit, not relied-upon-via-postinstall — matches the build stage's own
# approach and guarantees the client is actually generated regardless of
# whether @prisma/client's postinstall hook ran successfully above.
RUN npx prisma generate --schema=src/database/prisma/schema.prisma

COPY --from=build /app/dist ./dist
# docker-entrypoint.sh runs `prisma migrate deploy`, which reads this folder —
# it was missing here entirely before, so migrate deploy always saw "no
# migrations found" regardless of what was actually checked into the repo.
COPY src/database/prisma/migrations ./src/database/prisma/migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && chown -R node:node /app

# The app has no runtime need to write to its own filesystem (no fs.write*
# calls anywhere in src/ — pdfkit reports are buffered in memory, no
# multer/disk-storage upload path is wired up) — safe to drop root.
USER node

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
