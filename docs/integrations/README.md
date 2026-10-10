# Mirqab Dataset Integration

Tracks the "Mirqab Integration Task": wiring small, representative samples from 7 public security
datasets into the existing Mirqab architecture, one phase at a time. Distinct from `docs/phases/` (the
original 13-phase build history) — this is a later, separate initiative layered on top of that
architecture, not a continuation of it.

**Ground rules for this initiative** (see `datasets/README.md` for the full rationale):
- Lightweight, local-demo scale only — no multi-GB downloads, no new infrastructure (no Wazuh manager, no
  Zeek/Suricata/Splunk install).
- Every phase reuses and extends the existing backend/dashboard/desktop architecture; nothing is
  rewritten or replaced.
- Each phase updates this doc, then verifies the backend/dashboard/desktop still build and run before the
  next phase starts.

| Phase | Status | Doc |
|---|---|---|
| Dataset prep | Done | `datasets/README.md` + per-repo `NOTES.md` |
| 1 — Wazuh sample log ingestion | Done | `phase-1-wazuh-sample-ingestion.md` |
| 2 — LogHub SSH/Linux/Apache/Auth | Done | `phase-2-loghub-sample-ingestion.md` |
| 3 — Wazuh Logtest enrichment | Done (unverified live — no manager in this env) | `phase-3-wazuh-logtest-enrichment.md` |
| 4 — AI classifier training records | Done | `phase-4-ai-training-records.md` |
| 5 — PCAP-derived event source | Done | `phase-5-pcap-event-source.md` |
| 6 — Citadel attack path data | Done | `phase-6-citadel-attack-path.md` |
