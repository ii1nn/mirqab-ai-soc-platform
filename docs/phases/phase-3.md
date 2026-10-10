# Phase 3 — Employee Desktop Application

**Scope:** the Electron + React employee agent (`apps/employee-desktop`).
No backend or SOC dashboard changes.

## What was built

- **Electron shell:** frameless window with a custom title bar, single-instance
  lock, secure `webPreferences` (`contextIsolation: true`, `nodeIntegration:
  false`, `sandbox: true`), external links forced through the OS browser.
- **IPC surface** (`electron/ipc/`): `device.ipc.ts` (CPU/RAM/disk/Defender/
  firewall/processes/installed apps — real telemetry, Windows-first via `os`
  and fixed PowerShell commands, degrading gracefully elsewhere), `auth.ipc.ts`
  (refresh token encrypted at rest via `safeStorage`), `window.ipc.ts`
  (minimize/maximize/close), `system.ipc.ts` (deep links into Windows Settings
  for Defender/Firewall/Update, app version).
- **Preload bridge:** a single typed `window.mirqab` API surface; the renderer
  has no direct Node or `ipcRenderer` access.
- **Auth integration:** `src/store/auth.store.ts` + `src/services/auth.service.ts`
  wire up against the Phase 2 backend (`/auth/login|refresh|logout|me`).
  Access token in memory only; refresh token persisted encrypted on disk;
  axios interceptor in `api-client.ts` auto-refreshes once on 401.
- **Security score engine** (`features/security-score/scoreEngine.ts`): a
  deterministic 0–100 rubric over real signals (Defender, firewall, disk
  headroom, CPU load) — not randomized or fabricated.
- **Recommended fixes** (`features/recommended-fixes/fixEngine.ts`): derived
  directly from whichever security-score checks are failing; the "Fix it"
  button deep-links into the relevant Windows Settings page via IPC.
- **Feature pages:** Login, Dashboard (security score + quick stats + scan CTA
  + notification preview), Device Health (live CPU/memory chart via Recharts,
  protection status, disk usage), Device Info (identity, processes, installed
  apps), AI Scan, Incident History, Notifications.
- **UI kit:** glassmorphism `Card`, `Badge`, `MockBadge`, `Button`, `StatTile`,
  an SVG `ScoreGauge`, Framer Motion page transitions, Tailwind theme matching
  the Mirqab palette (`#0B1220` / `#111827` / `#00E5FF` / danger/warning/success).

## Mock data — explicitly marked

The backend has no AI engine or Incidents module yet (later phases), so two
places clearly flag placeholder content instead of inventing "real-looking"
data:

- **AI Scan** (`services/ai-scan.service.ts`): tries `POST /ai/scan` first;
  on failure (expected today), falls back to a local process-name watchlist
  check, tagged with a "Sample data" badge in the UI.
- **Incident History** (`services/incidents.service.ts`): real locally-detected
  issues are merged with 1–2 explicitly-tagged sample incidents that
  illustrate incident types a single endpoint can't detect on its own
  (brute force, phishing) until server-side correlation exists.

Everything else — device metrics, security score, recommended fixes — is
computed from real, locally-observed data.

## Design decision

"Security Score" is not a separate nav item; it's the centerpiece of the
Dashboard. It's derived from the same live metrics as Device Health, so a
standalone page would just duplicate that view.

## Next

Phase 4+: SOC Dashboard pages, backend AI engine (Claude + FAISS + MITRE
mapping), Incidents/Tickets/Devices backend modules, device monitoring
agents (Wazuh/Sysmon), simulation mode.
