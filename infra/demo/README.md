# Mirqab — evaluator demo

A fresh, self-contained Mirqab environment populated **only** with bundled,
license-cleared open-source security data. It does not use, need, or touch
any other Mirqab database, volume, or machine-specific file.

## Run it

Requirements: Docker Desktop / Docker Engine with Compose v2.

```bash
# 1. Configure (from the repository root)
cp infra/demo/.env.demo.example infra/demo/.env.demo
#    Edit infra/demo/.env.demo: set DEMO_ADMIN_PASSWORD and the four random
#    secrets (POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
#    MONITORING_INGEST_API_KEY). `openssl rand -hex 32` is a good generator.

# 2. One setup command
docker compose -f infra/demo/docker-compose.demo.yml --env-file infra/demo/.env.demo up -d --build
```

3. Open **http://localhost:8080** and sign in with `DEMO_ADMIN_EMAIL` /
   `DEMO_ADMIN_PASSWORD`. The first start takes a few minutes (image builds);
   the data import itself takes a few seconds once the backend is up.

The command is safe to run again at any time: migrations only apply what is
missing, the admin/organization/departments/devices are created only if
absent, and every dataset event is imported at most once. It never resets
or deletes data.

Stop: `docker compose -f infra/demo/docker-compose.demo.yml --env-file infra/demo/.env.demo stop`

## What happens on first start

1. Fresh PostgreSQL volume (`mirqab-demo_demo_postgres_data`) → `prisma migrate deploy`.
2. Seed: organization **"Mirqab Demo Organization"**, the demo Admin (from
   `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD`, never a built-in password), the
   standard departments/devices/policies.
3. `DemoDataService` (backend, enabled by `MIRQAB_DEMO_DATA=true`):
   - adds two clearly-named demo departments and the 5 hosts that appear in
     the datasets;
   - optionally creates a Security Analyst and an IT Technician (only if
     their email **and** password are set) to demonstrate RBAC — the
     technician only sees the APT29 department;
   - imports the datasets below through Mirqab's own pipeline
     (`AiService.analyzeLog` / `MonitoringService.ingestPcap`): rule-based
     classification, MITRE ATT&CK mapping, IOC/IOA and persistence detection,
     correlation, auto-tickets for HIGH/CRITICAL, notifications.

Nothing is hand-authored: every incident, indicator and ticket is whatever
the application itself derives from the dataset rows. No response actions
are fabricated — the incident action history starts empty.

## Datasets (bundled — nothing is downloaded at setup)

| Dataset | Upstream | Pinned commit | License | Used as |
|---|---|---|---|---|
| APT29 emulation plan (condensed, 22 steps) — `datasets/Security-Datasets/apt29-attack-chain.json` | https://github.com/OTRF/Security-Datasets | `d9d40ef123d2c87d5d3df28c96bcab4f0faccc87` (license file) | MIT — `datasets/Security-Datasets/LICENSE` | 22 events on hosts SCRANTON, NASHUA, UTICA, NEWYORK |
| PcapMonkey Zeek sample events (6 records) — `datasets/PcapMonkey/zeek-sample-events.json` | https://github.com/certego/PcapMonkey | `5e631f203ae6101a968b1607f2d7eed28a4602b4` (license file) | GPL-3.0-or-later — `datasets/PcapMonkey/LICENSE.txt` + full text in `COPYING` | 6 network events from 10.12.1.101 |
| MITRE ATT&CK technique reference (built into the backend classifier) | https://attack.mitre.org | — | MITRE ATT&CK Terms of Use (attribution) | Technique/tactic names |

**Deliberately excluded** from the demo (and not mounted into the demo
backend): `datasets/wazuh-sample-logs` (no upstream license — not
redistributable), `datasets/loghub` (research/academic-use-only license),
`datasets/EVTX-to-MITRE-Attack` (CC0, but decoding `.evtx` needs Windows'
`wevtutil`, unavailable in the Linux container), `datasets/botsv3` and
`datasets/attack_data` (hand-made/synthetic or taxonomy-only, not telemetry).

Demo device notes: hostnames and the PcapMonkey IP come from the datasets.
The APT29 plan names hosts but not their addresses or OS, so those four get
RFC 5737 documentation addresses (192.0.2.11–14, never routable) and OS
"Not provided by dataset".

## Safety

The demo **cannot isolate endpoints**: `docker-compose.demo.yml` hard-codes
every endpoint-control setting (Wazuh Active Response, generic EDR API)
to empty, and external AI to off. The 5-minute response window still runs:
unacknowledged HIGH/CRITICAL incidents show "Response window expired —
automated containment unavailable: no endpoint-control provider
configured" instead of isolating anything. The production isolation code is
unchanged; it is simply not configured here.

PostgreSQL and Redis are not published to the host; the UI/API are
published on `127.0.0.1` only.
