# splunk/botsv3 (reference only — no content downloaded)

Source: https://github.com/splunk/botsv3
License: CC0-1.0 (public domain) per the repo's own LICENSE.

## Why nothing was downloaded

The GitHub repo itself contains only a README and LICENSE — no data. The actual dataset is a separate
320.1MB tarball (`botsv3_data_set.tgz`) hosted on S3, distributed as **pre-indexed Splunk data** (meant to
be loaded into a running Splunk instance's index, not read as plain log files). That's both over the
"no large downloads" bar and not usable without a Splunk deployment, which this pass isn't standing up.

## What's here

- `frothly-attack-chain.json` — a small, **hand-authored mock** attack chain in the same shape as
  `datasets/Security-Datasets/apt29-attack-chain.json`, modeled on BOTS v3's publicly documented storyline
  (the "Frothly" brewery company: a phishing-driven laptop compromise, AWS credential theft, and
  cryptomining/data-exfiltration follow-on — this narrative and its MITRE mappings are widely written about
  in public BOTS v3 walkthroughs, not derived from downloading the actual dataset). Clearly synthetic —
  used only to give Citadel a second, differently-shaped demo attack chain alongside the real apt29 one.

## Mirqab integration (Integration Phase 6 — see docs/integrations/phase-6-citadel-attack-path.md)

Ported into `apps/soc-dashboard/src/citadel/attackChains.data.ts` as the `frothly` entry, same shape and
same `AttackPathGraph` rendering as the apt29 chain — Citadel's Attack Path tab has a chain switcher so
both scenarios (one real, one clearly marked mock) are selectable, each with its own graph and timeline.
If real BOTSv3 telemetry is wanted later, that requires standing up Splunk and loading the 320MB indexed
dataset — a deliberate follow-up, not something to fetch silently here.
