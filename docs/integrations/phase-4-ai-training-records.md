# Integration Phase 4 — AI Classifier Training Records

**Scope:** turn the EVTX-to-MITRE-Attack sample and splunk/attack_data's technique taxonomy into labeled
"AI-ready" training records, and integrate them into the existing AI pipeline as a genuine classifier
accuracy check — offline, no new database tables, and never touching the live Incident pipeline.

## Why no fine-tuning, no new DB table

Mirqab's "AI engine" is Claude API calls (`ClaudeService`) with a rule-based keyword matcher
(`MitreMappingService`) as the fallback (`docs/phases/phase-5.md`/`phase-13.md`) — there is no local model
that gets *trained* in this architecture, so "training records" here means **labeled benchmark data**: real
inputs with a known-correct MITRE ATT&CK answer, used to measure the existing classifier's accuracy. Per
your instruction, this stays a static data file (`training-records.data.ts`, the same convention as
`mitre-reference.data.ts`/`fix-catalog.data.ts`), not a Prisma model — no migration needed.

## What was added

- **`backend/src/modules/ai/training-data/training-record.interface.ts`** — the record shape: `id`,
  `provenance` (`'real' | 'synthetic'`), `datasetOrigin`, `sourceExcerpt` (the *same* shape
  `AiService.analyzeLog()` already classifies — not a special training-only format), `label`
  (MITRE technique/tactic), `metadata`, `timeline`.
- **`training-records.data.ts`** — 6 records:
  - **1 real** record: the actual parsed fields from `datasets/EVTX-to-MITRE-Attack/T1078-ID4625-failed-login.evtx`
    (Windows Security Event 4625, logon type 10, failure reason, source IP, etc.) — labeled `T1078 Valid
    Accounts` per that dataset's own categorization (ground truth preserved as-is from the source).
  - **5 synthetic** records, modeled on splunk/attack_data's real technique/tool taxonomy (verified via
    directory listing in dataset prep — see `datasets/attack_data/NOTES.md`) since its actual content is
    Git-LFS-locked and was never downloaded. Each is phrased as an accurate, plain description of a genuine
    technique — not keyword-stuffed — covering `T1110`, `T1105`, `T1059`, `T1053`, `T1071`.
- **`training-benchmark.service.ts`** — `TrainingBenchmarkService.run()`, injects the real
  `MitreMappingService` (no reimplementation) and classifies every record, returning per-record
  correct/incorrect plus aggregate accuracy.
- **`GET /ai/training-records/benchmark`** (new route on the existing `AiController`) — read-only, calls
  only `TrainingBenchmarkService.run()`. Never calls `AiService.analyzeLog()`, never touches
  `prisma.incident`.
- **`training-benchmark.service.spec.ts`** — 5 Jest tests (see results below).

## Verification (real, not predicted)

A first draft of the `T1105` synthetic excerpt ("PowerShell invoked a certutil download...") accidentally
also matched `T1059`'s `'powershell'` keyword, tying 1-vs-1 and losing to `T1059` on array order — caught by
actually running the test, not by manual tracing (the first Jest run genuinely failed 2/5). Fixed by
rephrasing to "An external attacker used a certutil download to perform a remote file copy..." (2 clean
`T1105` keyword matches, no `T1059` trigger), rebuilt, reran.

**`npx jest training-benchmark --verbose`, final run — 5/5 passed:**

```
PASS src/modules/ai/training-data/training-benchmark.service.spec.ts
  TrainingBenchmarkService
    √ every record labels a technique the rule-based classifier actually knows about
    √ runs all 6 bundled records and reports one result per record
    √ correctly classifies all 5 synthetic records (phrased to accurately describe a real technique)
    √ reports the real EVTX record as an honest classifier miss, not force-matched
    √ reports overall accuracy as 5 out of 6 (83%) — 5 synthetic hits, 1 honest real-data miss
```

**Full backend suite** (`npx jest`): 8 suites, 46 tests, all passed — zero regressions elsewhere.

**Live, against the running backend** (`GET /ai/training-records/benchmark`): identical result —
`total: 6, correct: 5, accuracy: 0.8333...`. All 5 synthetic records correctly classified
(`T1110`/`T1105`/`T1059`/`T1053`/`T1071`); the real EVTX record predicted `null` — reported honestly as a
miss, not adjusted to force a match.

**Confirmed read-only, twice**: queried the real Postgres row count directly (`SELECT COUNT(*) FROM
incidents` — bypassing the API's 200-row list cap, which would have hidden a real change) before and after
calling the benchmark endpoint. **1119 → 1119, unchanged** across two separate calls. The endpoint never
creates an `Incident`, `Ticket`, or `Notification` — confirmed by both code inspection and live measurement.

**Builds**: `backend`, `apps/soc-dashboard`, `apps/employee-desktop` all `npm run build` clean.

## Why the real EVTX record misses, honestly

`T1078`'s keywords are `'valid account misuse'`, `'compromised credentials'`, `'account takeover'`, `'login
from unusual location'`, `'impossible travel'`. A genuine, accurate description of a Windows 4625 event
("account failed to log on... Unknown user name or bad password... logon type 10") contains none of them —
"failed to log on" isn't the substring `'failed login'` either, so it doesn't even accidentally trip
`T1110`. This is the same documented, intended behavior noted in `docs/phases/phase-13.md`: an
`UNCLASSIFIED`/no-match result on real-world text the simple keyword matcher doesn't recognize is a correct,
expected outcome — not a bug to paper over by rewording the excerpt until it "passes."
