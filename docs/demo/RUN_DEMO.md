# MIRQAB — Run the Evaluator Demo

**Project:** MIRQAB — AI-Powered Security Operations Platform for SMBs
**Team:** Bdoor Fahed Alosaimi · Nouf Saleh Altalhi · Alaa Rafa Al Saad

A localhost-only demo started with one command. It imports public, license-cleared
security data (OTRF APT29 emulation plan and PcapMonkey Zeek events) through MIRQAB's
own pipeline. It **cannot isolate endpoints** and uses **no external AI**.

> **Verified end-to-end (27 Sep 2026):** these exact steps were followed from the packaged
> source zip on the development machine. All 5 services ran, and 48 of 48 checks passed
> (API, RBAC, realtime, reports, browser walkthrough, response window).
> **Not yet verified:** a run on a separate clean machine.

## 1. Requirements

- Docker Desktop (Windows/macOS) or Docker Engine (Linux) with Docker Compose v2
- Internet access for the first start (base images and npm packages are downloaded during the build)
- Free local port 8080 (or set `DEMO_HTTP_PORT`)

## 2. Get the project

Clone the repository and open a terminal in the repository root:

```bash
git clone https://github.com/ii1nn/mirqab-ai-soc-platform.git
cd mirqab-ai-soc-platform
```

## 3. Configure `.env.demo`

```bash
cp infra/demo/.env.demo.example infra/demo/.env.demo
# PowerShell: Copy-Item infra/demo/.env.demo.example infra/demo/.env.demo
```

Edit `infra/demo/.env.demo`:

| Variable | Value |
|---|---|
| `DEMO_ADMIN_EMAIL` | Admin login email (default `admin@mirqab.local`) |
| `DEMO_ADMIN_PASSWORD` | Your own password, 8+ characters (required) |
| `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MONITORING_INGEST_API_KEY` | Random strings; JWT secrets at least 32 characters (required) |
| `DEMO_ANALYST_*`, `DEMO_TECHNICIAN_*` | Optional RBAC demo accounts (set both email and password) |
| `DEMO_HTTP_PORT` | Optional, default 8080 |

Generate random values:

```bash
openssl rand -hex 32
# PowerShell: -join ((1..64) | % { '{0:x}' -f (Get-Random -Max 16) })
```

## 4. Start (one command)

```bash
docker compose -f infra/demo/docker-compose.demo.yml --env-file infra/demo/.env.demo up -d --build
```

The first start takes several minutes because it builds the images. Running the command
again is safe: it never resets or deletes data.

## 5. Health check

```bash
docker compose -f infra/demo/docker-compose.demo.yml --env-file infra/demo/.env.demo ps
docker compose -f infra/demo/docker-compose.demo.yml --env-file infra/demo/.env.demo logs backend
```

The backend log should contain `Demo data ready` (22 APT29 steps and 6 PcapMonkey events
imported) and `Nest application successfully started`. Warnings that external AI, Wazuh
and endpoint control are disabled are expected.

## 6. Open and log in

Open **http://localhost:8080** and sign in with `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`.
The UI starts in Arabic; switch to English with the language button (top right).

## 7. Demo workflow

Dashboard → Incidents (filter High) → open an incident → Evidence → MITRE →
Suggested Solutions → Response timer (Acknowledge & Investigate) → Live Network Map /
The Citadel → Attack Path → Isolate Endpoint (confirmation dialog only; no provider is
configured, so nothing is isolated) → Notifications → Download Case Report (PDF) →
Reports (weekly report).

## 8. Stop safely

```bash
docker compose -f infra/demo/docker-compose.demo.yml --env-file infra/demo/.env.demo stop
```

Do **not** add `-v` to a `down` command unless you intend to delete the demo database.

## Limitations

- Verified end-to-end on the development machine only; not yet validated on a separate clean machine
- Localhost-only plain HTTP; not for network exposure
- No endpoint control and no external AI in the demo
- Detection covers 12 MITRE ATT&CK techniques, so part of the data stays "Unclassified"
