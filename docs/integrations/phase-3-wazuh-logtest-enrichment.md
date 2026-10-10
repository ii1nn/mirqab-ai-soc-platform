# Integration Phase 3 — Wazuh Logtest Enrichment

**Scope:** integrate the real Wazuh Manager Logtest API as the authoritative decode/rule-match step ahead
of storage, replacing Integration Phase 1/2's heuristic parsers whenever a manager is actually configured
and reachable — while leaving their heuristics as the honest fallback, since no Wazuh manager exists in
this environment (per your decision when Phase 3 started: build against the documented interface, skip
live testing for now).

## The documented contract this was built against

Not written from memory — pulled from Wazuh's own published OpenAPI spec,
`wazuh/wazuh`'s `api/api/spec/spec.yaml` (verified against the `v4.9.0` tag):

- **`POST /security/user/authenticate`** — HTTP Basic auth (`user:password`) → `{ data: { token }, error: 0 }`.
  Token defaults to a 900-second lifetime (spec: `auth_token_exp_timeout`, default 900).
- **`PUT /logtest`** — Bearer-authenticated. Request body (`LogtestRequest` schema, required fields
  `event`, `log_format`, `location`): `{ token?, log_format, location, event }`. `log_format` is an enum
  including `syslog`, `json`, `eventchannel`, etc. — not free text.
- Response (`ApiResponse` schema, example straight from the spec): `{ error: 0, data: { messages, token,
  output: { rule: { id, level, description, groups, firedtimes, mitre? }, agent, manager, full_log,
  decoder, location }, alert, codemsg } }`.

`backend/src/modules/monitoring/wazuh-logtest/wazuh-logtest.types.ts` mirrors these shapes field-for-field.

## What was added

- **`wazuh-logtest.types.ts`** — the request/response TypeScript types above.
- **`wazuh-logtest.client.ts`** — `WazuhLogtestClient`, deliberately shaped like the existing
  `ClaudeService` (`backend/src/modules/ai/claude/claude.service.ts`): `isAvailable()` is `false` whenever
  `WAZUH_API_URL`/`WAZUH_API_USER`/`WAZUH_API_PASSWORD` aren't all set, `run()` throws on any failure and
  is always meant to be called inside a try/catch with a fallback — the same degrade-gracefully contract
  Claude already established, reused rather than inventing a second pattern. Uses Node's built-in `fetch`
  (Node 24 here) — no new dependency added.
- **Config**: `wazuh.apiUrl`/`apiUser`/`apiPassword` added to `configuration.ts` and `env.validation.ts`
  (all optional, same as `ANTHROPIC_API_KEY`/`REDIS_URL`), documented in `backend/.env.example`,
  `infra/docker/.env.example`, and passed through in `infra/docker/docker-compose.yml` — all empty by
  default, no new infrastructure stood up.

### Wiring into Phase 1/2, not into AiService

The enrichment happens **only** at the ingestion/normalization layer (`WazuhSamplesService.seed()` and
`LoghubSamplesService.seed()`), not inside `AiService`. Each now has a private `enrichWithLogtest()`:

1. If `WazuhLogtestClient.isAvailable()` is `false` (this environment, always) → use the Phase 1/2
   heuristic parser's output unchanged.
2. If available, call `run({ log_format, location, event: rawLine })`:
   - Wazuh sample lines: `log_format` is `json` for the Kubernetes/AWS lines, `syslog` for the Fortigate
     ones (matching the enum).
   - LogHub lines: `syslog` for SSH/Linux. **Apache's error-log format has no matching entry in the
     documented `log_format` enum**, so it's always left on the heuristic parser — a real, stated
     limitation, not something silently faked.
3. On success, the real `rule.id`/`level`/`description` replace the heuristic guess, and if `rule.mitre` is
   present its technique names/IDs are appended to the description text — so `AiService`'s existing
   classifier (Claude, or its rule-based keyword matcher) naturally picks up the real MITRE mapping from
   the enriched text. `AiService` itself was **not modified** — it still independently classifies every
   event exactly as it did before this phase, for every source.
4. On any failure (network error, non-200, no rule matched), falls back to the heuristic parser and logs a
   warning — never throws, never drops the event.

Every ingestion result now reports `enrichedByLogtest: boolean` so it's visible (API response, and a count
on the Settings page) which path actually produced each event, rather than leaving that invisible.

## Verification

- `npm run build` passes in `backend/` and `apps/soc-dashboard/`; `employee-desktop` also builds
  (untouched by this phase, checked for regressions).
- Backend hot-reloaded cleanly; `wazuh-logtest`'s new routes' dependents (`WazuhSamplesController`,
  `LoghubSamplesController`) registered with no startup errors.
- Ran both `POST /monitoring/wazuh-samples/seed` and `POST /monitoring/loghub-samples/seed` live against
  the running backend: all 19 events (9 Wazuh + 10 LogHub) show `enrichedByLogtest: false`, and severity/
  MITRE results are **identical** to the pre-Phase-3 runs (Phase 1/2's own verification tables) — confirming
  the fallback path is a true no-op when Logtest isn't configured, not a regression.
- **What's unverified**: the actual live `run()` call against a real manager (steps 2–3 above). No Wazuh
  manager exists in this environment, and none was stood up (per your decision at the start of this phase).
  The request/response handling is written directly against the documented OpenAPI spec, not guessed, but
  it has not executed against a real server. This is the one open item a real deployment would need to
  close — pointing `WAZUH_API_URL` at a real manager and confirming a genuine `rule.mitre` payload
  round-trips correctly.

## How to try it (once a manager exists)

Set `WAZUH_API_URL`, `WAZUH_API_USER`, `WAZUH_API_PASSWORD` in `backend/.env`, restart the backend, then
run either Settings page "Load Wazuh/LogHub sample data" button — the result count now shows how many
events came from Logtest vs the heuristic fallback.
