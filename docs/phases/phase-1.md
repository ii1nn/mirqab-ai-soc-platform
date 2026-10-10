# Phase 1 — Project Structure

**Scope:** folder hierarchy only. No source code, no config files with logic,
no dependencies installed.

## What was created

- `apps/soc-dashboard` — feature-sliced structure for all 13 dashboard pages
  (dashboard, alerts, devices, departments, threat-map, tickets, policies,
  reports, analytics, incident-memory, settings, user-management, audit-logs,
  citadel-live-view) plus shared components/hooks/layouts/services/store/types.
- `apps/employee-desktop` — Electron main/preload/ipc split, plus feature
  folders for login, device-health, ai-scan, notifications, security-score,
  device-info, incident-history, recommended-fixes.
- `backend` — NestJS module-per-domain layout: auth, users, devices,
  departments, tickets, alerts, incidents, policies, audit-logs, notifications,
  threat-intel, incident-memory, ai (claude / mitre-attack / similarity-engine),
  monitoring (wazuh / sysmon / suricata), websocket, simulation. Plus common/
  (decorators, filters, guards, interceptors, pipes, rbac), config, database
  (prisma + seed), redis.
- `ai-engine` — standalone service skeleton for FAISS vector store, MITRE
  mapping, Claude client, and its own API layer.
- `packages` — shared-types, ui-kit, config for cross-app reuse.
- `infra` — docker (postgres, redis, nginx), monitoring (wazuh, suricata),
  simulation.

## Next

Phase 2 will implement the authentication module (NestJS auth module, JWT +
refresh tokens, RBAC guards, Prisma User model) without touching any other
module's internals.
