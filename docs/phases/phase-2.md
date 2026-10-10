# Phase 2 — Authentication Module

**Scope:** NestJS backend bootstrap + the authentication/RBAC vertical slice.
No other domain modules (devices, tickets, alerts, etc.) were touched.

## What was built

- **Project scaffolding:** `package.json`, `tsconfig*.json`, `nest-cli.json`,
  ESLint/Prettier config, `Dockerfile`, `.env.example`.
- **Prisma:** `schema.prisma` with `User`, `Role` enum
  (`ADMIN` / `SECURITY_ANALYST` / `IT_TECHNICIAN` / `EMPLOYEE`), and
  `RefreshToken` (hash-only storage, rotation-friendly). `PrismaModule`
  (global) + `PrismaService`. A seed script bootstraps the first admin
  from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- **Config:** typed `configuration.ts` + Joi `env.validation.ts`, wired
  through `@nestjs/config` in `AppModule`.
- **Common layer:** `@Public()`, `@Roles()`, `@CurrentUser()` decorators;
  `JwtAuthGuard` (global, skips `@Public()` routes), `RolesGuard` (global,
  no-op unless `@Roles()` is present), `JwtRefreshGuard` (refresh-only route);
  a global `HttpExceptionFilter` for a consistent error envelope.
- **Users module:** `UsersService` (create/findByEmail/findById/updateLastLogin),
  password hashing via `bcryptjs`, `UserEntity` (excludes `passwordHash` from
  serialized responses via the global `ClassSerializerInterceptor`).
- **Auth module:** `AuthService` (login, register, refresh with rotation +
  reuse detection, logout, profile lookup), Passport `jwt` and `jwt-refresh`
  strategies, `AuthController` exposing `/auth/{register,login,refresh,logout,me}`.
- **Bootstrap:** `app.module.ts` wires Config/Prisma/Users/Auth; `main.ts`
  applies Helmet, CORS (from env), a global `ValidationPipe`, the serializer
  interceptor, the exception filter, and an `/api/v1` prefix.
- **Tests:** `auth.service.spec.ts` covers valid/invalid login, inactive
  accounts, refresh-token rotation, and reuse-detection revocation, all
  against mocked Prisma/Users/Jwt — no live database required.

## Design notes

- Refresh tokens are JWTs (so signature + expiry are verified by Passport
  for free) whose **hash** is persisted; the raw token never touches the
  database. Rotation on every refresh + family-wide revocation on replay is
  the standard mitigation for stolen refresh tokens.
- `RolesGuard` and `JwtAuthGuard` are registered globally from `AuthModule`
  via `APP_GUARD` — every route is authenticated-by-default; opt out with
  `@Public()`, restrict further with `@Roles(...)`.
- `AuthenticatedUser` (the `request.user` shape) lives in `common/interfaces`,
  not inside the auth module, so other modules' guards/decorators don't have
  to reach into `modules/auth` — keeps the dependency direction one-way
  (`modules/* → common`, never the reverse).

## Next

Phase 3: the Employee Desktop application (Electron + React) — login screen
consuming `/auth/login`, secure token storage, and the first device-health
features.
