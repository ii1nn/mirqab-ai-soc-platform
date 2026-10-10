# splunk/attack_data (reference only — no content downloaded)

Source: https://github.com/splunk/attack_data
License: Apache-2.0

## Why nothing was downloaded

The repo is ~9GB total and every dataset file is stored via **Git LFS**. Confirmed directly: fetching
`datasets/attack_techniques/T1003.003/atomic_red_team/windows-sysmon.log` returns a 133-byte LFS pointer,
not log content — the real file behind it is 12.9MB (`size 12883992` in the pointer). Individual files
across the repo run from several MB to much larger, and pulling real content requires the `git-lfs` client
against LFS media servers, not a plain file fetch. Given the "no large downloads" constraint, this repo is
used as a **structure/taxonomy reference only**.

## Structure (verified via directory listing, no content pulled)

`datasets/attack_techniques/<TECHNIQUE_ID>/<tool>/` — e.g. `T1003.003/atomic_red_team/` contains
`windows-sysmon.log`, `windows-security.log`, `windows-powershell.log`, `crowdstrike_falcon.log`, an
Atomic Red Team test manifest (`atomic_red_team.yml`), etc. Each technique folder is the ground-truth label.

## Mirqab integration (Integration Phase 4)

Real content came only from `EVTX-to-MITRE-Attack`'s single sample (see sibling `datasets/EVTX-to-MITRE-Attack/NOTES.md`).
This repo's technique/tool taxonomy shaped 5 **synthetic** training records with the same label structure
attack_data would provide (technique ID, tactic, metadata, timeline) — clearly marked `provenance: 'synthetic'`
so they're never confused with the one real, EVTX-parsed record.

The actual training records live in
`backend/src/modules/ai/training-data/training-records.data.ts` (the same static-TS-data convention the
backend already uses for `mitre-reference.data.ts`/`fix-catalog.data.ts`) rather than as a JSONL file here —
kept in one place to avoid two copies of the same data drifting apart. `TrainingBenchmarkService` (same
folder) runs every record through the real rule-based classifier (`MitreMappingService`) as an accuracy
check; see `docs/integrations/phase-4-ai-training-records.md` for the actual results, including one honest
classifier miss on the real EVTX record.

If real attack_data content is wanted later, that's a deliberate follow-up requiring `git-lfs` and accepting
multi-MB-per-file downloads — not something this pass does silently.
