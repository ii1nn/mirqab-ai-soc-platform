# Integration Phase 6 — Citadel Attack Path Visualization

**Scope:** power a new "Attack Path" view in the existing Citadel module using the two attack chains
already prepared (real APT29 emulation data, mock Frothly/BOTSv3 scenario) — attack chains, timelines,
MITRE ATT&CK mappings, and attacker movement, integrated into the existing Citadel feature rather than a
new page/module.

## What the "existing Citadel module" actually is

`apps/soc-dashboard/src/features/citadel/CitadelLiveViewPage.tsx` ("THE CITADEL — LIVE VIEW") is a
real-time SOC wall display: a fixed infrastructure topology (`ThreatTopology`, department nodes lighting up
from live incident severity) plus a live alerts feed, driven by real `Incident` data. There was no existing
per-attack-chain / MITRE-technique-sequence visualization anywhere in the codebase — that's the actual gap
this phase fills, as a second view within the same page, not a rewrite of the live view.

## What was added

Entirely client-side/static — this is fixed reference/demo content (two specific attack chains), not
something tied to live incidents or requiring a database round-trip. Same precedent Simulation Mode already
set with its own bundled `simulation/scenarios.ts`:

- **`citadel/attackChains.data.ts`** — `ATTACK_CHAINS`, the two chains ported verbatim from
  `datasets/Security-Datasets/apt29-attack-chain.json` (real, 21 steps) and
  `datasets/botsv3/frothly-attack-chain.json` (mock, 9 steps) — see those files' `NOTES.md` for how each
  was produced.
- **`components/widgets/AttackPathGraph.tsx`** — new ReactFlow component (same library `ThreatTopology`
  already uses, no new dependency): one node per distinct host, one edge per step where the attacker
  actually moved between hosts (`source !== target`). Steps that happen on a single host (recon,
  persistence, credential dumping, ...) are counted on that host's node as a "N local steps" badge instead
  of drawn as a confusing self-loop edge — a deliberate design choice, not an oversight.
- **`CitadelLiveViewPage.tsx`** — extended, not replaced: a "Live View" / "Attack Path" toggle at the top
  (state-only change, existing Live View JSX untouched), and a new Attack Path branch: a chain switcher
  (APT29 tagged "Real data", Frothly tagged "Mock" — provenance visible in the UI, not just in docs), the
  `AttackPathGraph`, and a timeline side panel listing every step in order with its stage, MITRE technique
  IDs, and description.

### No new database tables, no new backend module, no changes to AiService/Incident pipeline

Two static chains don't need persistence or a live API — exactly the same reasoning Integration Phase 4
applied to keep training records out of the database.

## Verification

- **`backend`**: `npm run build` clean (untouched by this phase — confirmed no regression anyway).
- **`apps/soc-dashboard`**: `npm run build` clean, and `npm run lint` reports **0 errors** on the new files
  (6 pre-existing warnings elsewhere, unrelated to this phase — confirmed by file path).
- **`apps/employee-desktop`**: `npm run build` clean (untouched, confirmed no regression).
- **What's honestly not verified**: no browser automation tool was available this session, so the graph
  was not visually confirmed rendering in an actual browser. Verification here is TypeScript's structural
  check (props, imports, JSX types all valid) plus ESLint's React-specific static analysis (hook rules,
  JSX correctness) — both passing — plus manual review of the ReactFlow usage against `ThreatTopology`'s
  already-proven-working patterns (same node/edge/`Handle` structure, same `nodeTypes` registration
  pattern). This is a real limitation, stated plainly rather than claiming a visual check that didn't
  happen — a good next step if you want stronger confidence is running the dashboard locally and opening
  Citadel → Attack Path yourself.

## How to try it

SOC Dashboard → Citadel → **Attack Path** toggle (top right, next to Live View). Switch between "APT29 —
MITRE ATT&CK Evaluations" and "Frothly (BOTS v3 scenario)" to see each chain's host-movement graph and full
step timeline.
