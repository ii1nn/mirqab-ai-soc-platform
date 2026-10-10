# PcapMonkey (sample)

Source: https://github.com/certego/PcapMonkey
License: GPL (see upstream `LICENSE.txt`)

PcapMonkey itself is a Docker/Suricata/Zeek pipeline for turning `.pcap` files into normalized events in
Elasticsearch — that's heavy infrastructure (Docker services, Zeek/Suricata binaries) which this pass
deliberately does not stand up. No `.pcap` files are bundled in the repo either. Instead, its own test
fixture — `test/expected_zeek.json`, the *expected output* of running Zeek through PcapMonkey on a test
capture — was used, since that's exactly the normalized-event shape Phase 5 needs to integrate against.

## What's here

- `zeek-sample-events.json` — 6 records selected from the 615 in the upstream fixture (fetched in memory
  and immediately reduced, only the small selection was written to disk), one per distinct Zeek dataset
  type: `zeek.connection`, `zeek.dns`, `zeek.http`, `zeek.notice`, `zeek.ssl`, `zeek.weird`. Format is
  Elastic Common Schema (ECS): `_source.event.dataset`, `_source.source/destination.{ip,port}`,
  `_source.network.{bytes,transport}`, `_source.zeek.<type>.*` for protocol-specific fields.

## Mirqab integration (Integration Phase 5 — see docs/integrations/phase-5-pcap-event-source.md)

Since there's no live pcap→Zeek pipeline in this demo, these 6 ECS-shaped records stand in for "PcapMonkey
output" and are fed through a small parser (`backend/src/modules/monitoring/pcap-samples/`) that maps ECS
fields into a new `PcapEventDto` (source/destination IP+port, transport, a protocol-specific one-line
`detail` summary, timestamp) and a new `POST /monitoring/pcap` route, then classified/stored/exposed
exactly like Phase 1/2's events — no hand-assigned severity per dataset type; severity and MITRE mapping
come from the same `AiService` classification every other source uses (see the Phase 5 doc for the actual,
honestly-reported result: all 6 land `UNCLASSIFIED`/LOW under the rule-based fallback, since none of this
codebase's 12 curated technique keywords are network-flow-specific). A real deployment would swap this
parser's input for PcapMonkey's actual Elasticsearch output or a live Zeek JSON log stream; the DTO and
ingestion path don't change.
