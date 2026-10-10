# OTRF/Security-Datasets (sample)

Source: https://github.com/OTRF/Security-Datasets
License: MIT (root `LICENSE` file — the "GPL-3.0" footer badge seen on the repo page is stale/incorrect; the actual `LICENSE` file is MIT).

The real telemetry datasets under `datasets/compound/apt29/day1` and `day2` are 367MB and 1.6GB zips — not
pulled. Instead, the **emulation plan spreadsheet** (`emulationplans/apt29.xlsx`, 25KB) was downloaded — it's
the human-readable, step-by-step description of the same APT29 scenario the big telemetry captures: MITRE
ATT&CK Evaluations Round 2, a 20-step, 4-host multi-day intrusion chain.

## What's here

- `apt29-emulation-plan.xlsx` — the original spreadsheet as downloaded (2 sheets, one per emulation day),
  8 columns: Stage, Technique, Step, Description, hands-on, User, Source, Target.
- `apt29-attack-chain.json` — 21 of the 30+ steps, hand-condensed from the spreadsheet's real content
  (extracted from its `sharedStrings.xml` — the xlsx was inspected via `Expand-Archive`, no Excel/module
  needed) into a compact `{step, stage, techniques[], source, target, description}` shape. Verbose
  hands-on command text/credentials were dropped; step IDs, MITRE technique IDs, hosts (UTICA → SCRANTON →
  NASHUA → NEWYORK), and stage names are all real, not invented.

## Mirqab integration (Integration Phase 6 — see docs/integrations/phase-6-citadel-attack-path.md)

This data was ported verbatim into `apps/soc-dashboard/src/citadel/attackChains.data.ts` (the `apt29` entry)
— static client-side data, same convention as the existing Simulation Mode's `simulation/scenarios.ts` —
and is rendered by the new `AttackPathGraph` component on Citadel's new "Attack Path" tab: one graph node
per distinct host (`attacker`, `SCRANTON`, `NASHUA`, `UTICA`, `NEWYORK`), one edge per step where the
attacker actually moved between hosts (`source !== target`, e.g. `8.C: SCRANTON -> NASHUA`), and steps that
happen on a single host (recon, persistence, credential dumping, ...) counted on that host's node instead
of drawn as a self-loop. The full ordered step list — stage, MITRE technique IDs, description — is shown
as a timeline panel alongside the graph.
