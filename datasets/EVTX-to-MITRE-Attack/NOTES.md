# EVTX-to-MITRE-Attack (sample)

Source: https://github.com/mdecrevoisier/EVTX-to-MITRE-Attack
License: CC0-1.0 (public domain dedication) — unrestricted use.

The upstream repo is organized as one `.evtx` file per MITRE ATT&CK technique (270+ files across TA0001–TA0040 tactic folders). Rather than pulling the whole tree, one representative file was downloaded directly.

## What's here

- `T1078-ID4625-failed-login.evtx` (68KB) — from `TA0001-Initial access/T1078-Valid accounts/`. Windows Security Event ID 4625 ("An account failed to log on"), 2 events, parsed and verified locally with `Get-WinEvent` (built into Windows, no extra tooling needed).
  - Tactic: TA0001 Initial Access
  - Technique: T1078 Valid Accounts
  - Verified fields: EventID 4625, LogonType 10, FailureReason "Unknown user name or bad password", SourceNetworkAddress 10.23.23.9.

## Mirqab integration (Phase 4)

`Get-WinEvent`/the .NET `EventLogReader` can parse `.evtx` natively on Windows, so no extra dependency is needed for this format specifically. This one file's parsed fields become one labeled training record (see `datasets/attack_data/ai-training-samples.jsonl`) demonstrating the EVTX → labeled-record path: technique/tactic label preserved as ground truth, timeline (`TimeCreated`), and metadata (host, account, source IP) preserved for the AI Incident Classifier.
