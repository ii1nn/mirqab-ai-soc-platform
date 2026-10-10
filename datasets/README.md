# Mirqab datasets (lightweight demo samples)

> **Evaluator demo (`infra/demo`)** imports only the license-cleared
> `Security-Datasets/` (MIT, license in `Security-Datasets/LICENSE`) and
> `PcapMonkey/` (GPL-3.0-or-later, `PcapMonkey/LICENSE.txt` + `COPYING`)
> samples. `wazuh-sample-logs/` (no license) and `loghub/` (research-only
> license) are not redistributable and are never used by the demo — see
> `infra/demo/README.md`.

This folder holds small, representative samples pulled from 7 public security-dataset repositories — **not
full clones**. Per project direction, this is kept lightweight and demo-scale: no multi-GB downloads, no
extra infrastructure (no Wazuh manager, no Zeek/Suricata install, no Splunk). Total size: ~0.22MB.

Each subfolder has its own `NOTES.md` with the source URL, license, exactly what was kept and why, and how
it plugs into the corresponding Mirqab integration phase.

| Folder | Source | License | Used in |
|---|---|---|---|
| `wazuh-sample-logs/` | geercaceres/wazuh-sample-logs | none found (demo-only) | Phase 1 |
| `loghub/` | logpai/loghub | MIT-style research license (see `LICENSE`) | Phase 2 |
| `EVTX-to-MITRE-Attack/` | mdecrevoisier/EVTX-to-MITRE-Attack | CC0-1.0 | Phase 4 |
| `attack_data/` | splunk/attack_data | Apache-2.0 | Phase 4 (reference only, see below) |
| `PcapMonkey/` | certego/PcapMonkey | GPL | Phase 5 |
| `Security-Datasets/` | OTRF/Security-Datasets | MIT | Phase 6 |
| `botsv3/` | splunk/botsv3 | CC0-1.0 | Phase 6 (reference only, see below) |

## Two repos are reference-only, not sampled

- **splunk/attack_data**: every dataset file is Git-LFS-backed (verified: one "log" file's raw content is
  a 133-byte LFS pointer to a 12.9MB real file). Used only for its technique/tool folder taxonomy.
- **splunk/botsv3**: the GitHub repo has no data at all — the real dataset is a 320MB tarball of
  pre-indexed Splunk data hosted on S3, unusable without a Splunk deployment. Used only as the basis for a
  clearly-marked mock attack chain (`botsv3/frothly-attack-chain.json`).

Both are documented in their respective `NOTES.md` with what a real integration would require, so that's a
deliberate, visible follow-up rather than a silent gap.
