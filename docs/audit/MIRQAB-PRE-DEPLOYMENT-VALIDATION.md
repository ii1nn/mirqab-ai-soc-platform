# MIRQAB — Full Pre-Deployment Validation

**Date:** 2026-09-06
**Scope:** Live, running-system validation — not a static code review. The full custom stack (Postgres, Redis, backend, soc-dashboard, nginx) plus a real vendored Wazuh single-node stack (manager, indexer, dashboard) and a real containerized Wazuh agent were brought up on this machine and exercised end-to-end via authenticated HTTP calls, direct Wazuh Manager API calls, and database/Redis inspection. This report reads alongside `docs/audit/MIRQAB-SYSTEM-AUDIT.md` (Phase 5.5, dependency/license/secrets audit) rather than repeating it — this report is about functional and operational reality, not package versions.

**What this validation could NOT do:** no browser automation tool was available in this session, so the actual dashboard UI was never visually opened/clicked through (Phase 8's UI walkthrough). Every finding about frontend data-reality is either (a) static code reading of the frontend's own data-fetching hooks (no mock arrays found outside the two disclosed employee-desktop cases), or (b) confirmed indirectly by calling the exact same backend endpoints the frontend calls and getting real data back — not a substitute for an actual rendered-page check. The Electron employee-desktop app was build-verified (`npm run build` succeeds cleanly) but never launched as a GUI. Both are genuine environment limitations of this validation session, not claims that these are broken.

---

## 1. Executive Summary

**Verdict: READY FOR LAB.**

Mirqab is a real, substantially-working system — not a prototype or a facade. This validation independently registered a live Wazuh agent, sent real Wazuh-alert-shaped payloads through the actual ingestion pipeline, and confirmed the full chain (device resolution → classification → MITRE mapping → severity → correlation → IOC extraction → auto-ticketing → notifications → risk prediction → similarity search) genuinely executes against a real Postgres database with no fabricated data anywhere in that path. Auth, JWT handling, rate limiting, CORS, security headers, and most RBAC are real and correctly enforced.

It is not ready for an **internal pilot** (multiple real staff with different roles) for one specific, serious reason found live in this validation: **the incident list endpoint (`GET /ai/incidents`) has no department-level access control**, so any authenticated IT_TECHNICIAN can read every department's full incident history, including Finance's. That is a P0 confidentiality bug in a security product, not a hypothetical — it was reproduced and evidenced in this session. Device isolation — the other feature a SOC pilot would actually depend on — was tested end-to-end for the first time against a real Wazuh Manager and a real registered agent, and failed on a TLS certificate hostname mismatch, not on missing logic; the code's own design (never fabricate a SUCCESS outcome) worked exactly as intended and correctly reported a real `FAILED`. Combined with the live, unrotated secrets already flagged in Phase 5.5 and an Electron build that is materially past its security-support window, these are the blockers between "works in a lab" and "safe to hand to real analysts."

None of this required an architecture change to find or to fix. Every blocker below has a narrow, well-understood remediation path.

## 2. System Status

| Component | Status | Evidence | Required Fix |
|---|---|---|---|
| Frontend (soc-dashboard) | **PARTIALLY VERIFIED** — backend-data-real, UI unopened | SPA served correctly at `https://localhost/` (200, correct built title/bundle); its own hooks (`useDepartments`/`useDevices`/`useIncidents`) call real endpoints confirmed independently returning real data; no mock arrays found in threat-map/incidents code | Open the actual UI in a browser and click through Phase 8's workflows — not done this session |
| Backend (NestJS) | **REAL, FUNCTIONAL** | Full incident pipeline exercised live via direct HTTP; 405 real incidents / 15 devices / 5 users in Postgres; all routes mapped and responding | Fix the P0 RBAC gap below before any pilot |
| PostgreSQL | **REAL, FUNCTIONAL** | `docker exec` query confirms real row counts across 19 tables; migrations applied | None |
| Redis | **REAL, FUNCTIONAL** | Live `ioredis` connections and active Socket.IO pub/sub channels confirmed via `CLIENT LIST`/`PUBSUB CHANNELS` — cross-instance broadcast is genuinely wired, not decorative | None |
| Wazuh (Manager/Indexer/Dashboard) | **REAL, FUNCTIONAL, but two gaps** | Manager API live (`v4.14.7`, full healthy process table); Indexer green/healthy with 558 real indexed alert docs; a real test agent (`IT-SRV-01`) registered and went `active` | (1) Dashboard's default port collides with Mirqab's own nginx on 443 — fixed for this session, see Section 7; (2) `mirqab-integration.py` (the script that makes a real Wazuh alert auto-forward to Mirqab) has never been installed on any manager — the automatic path is unverified, only its manual-POST equivalent has been tested |
| AI Agent 1 — INCIDENT_AGENT | **REAL logic, rule-based fallback (no live Claude)** | See Section 3 | Configure `ANTHROPIC_API_KEY` if real-LLM classification is wanted for the pilot; the rule-based fallback is honest and functional as-is |
| AI Agent 2 — IOC_IOA_AGENT | **REAL** (deterministic, not LLM-based by design) | See Section 3 | None — working as designed |
| AI Agent 3 — MITRE_RISK_AGENT | **REAL** (deterministic, not LLM-based by design) | See Section 3 | None — working as designed |
| AI Agent 4 — RECOMMENDATION_AGENT | **REAL but empty by design** | See Section 3 | None — returns `[]` until real `IncidentAction` history accumulates; this is documented, expected behavior, not a bug |
| Employee Agent (desktop) | **PARTIALLY MOCKED (disclosed)** | Builds cleanly (`npm run build`, both the renderer and Electron main/preload bundles); "AI Scan" is a local hardcoded-watchlist heuristic with no backend call at all; Incident History always includes 2 hardcoded fake incidents — both UI-labeled with a visible `MockBadge`, not hidden | Decide before pilot whether the "AI Scan" feature should call the real backend/AI pipeline, since as shipped it does not |
| Notifications | **REAL** | Real `Notification` rows created and observed on every incident create/correlate in this session's live tests, for both EMPLOYEE and ANALYST audiences | None found; real-time delivery path (`RealtimeGateway`) inferred wired via Redis pub/sub evidence, not visually confirmed in a browser |
| Live Map / Threat Map | **REAL (backend-verified)** | Real react-query hooks against real `/departments`/`/devices`/`/ai/incidents` endpoints, no mock data found in source | Visual UI confirmation not performed this session |
| Device Isolation | **BROKEN (config/TLS bug, not a logic bug)** | See Section 4 — real Active Response command dispatched by Mirqab, real Wazuh agent received nothing, correctly reported `FAILED`, never fabricated `SUCCESS` | Fix the Wazuh Manager API certificate's SAN (or how Mirqab connects to it) — see Section 6, P0 |

## 3. Four AI Agents

Ground truth from reading `backend/src/modules/ai/agents/agent-permissions.ts` and `ai.service.ts`, then exercised live via `POST /ai/analyze` and `GET /ai/incidents/:id/investigation` against the running backend. All four are `AiService` methods sharing one Prisma audit table (`AiAgentDecision`), not four separate processes — that is the actual architecture, not a simplification made for this report.

### Agent 1 — INCIDENT_AGENT
- Exists: YES (`AiService.classify()`)
- Runs: YES — triggered automatically on every `/ai/analyze` call and every monitoring-ingestion call (`/monitoring/wazuh|suricata|sysmon`)
- Calls real AI: **NO in this environment** — `ANTHROPIC_API_KEY` is empty (confirmed live, both in `.env` and inside the running container's actual process environment), so `ClaudeService.isAvailable()` is false and every classification in this session ran the rule-based keyword/MITRE matcher instead. Backend startup log confirms this explicitly: `[ClaudeService] WARN ANTHROPIC_API_KEY is not set — AI features will use rule-based fallbacks.` The Claude SDK dependency and wiring are real and correctly initialize (`ClaudeModule dependencies initialized`); they are simply never invoked as configured.
- Produces real output: YES — every field (`mitreTechniqueId`, `mitreTactic`, `severity`, extracted `sourceIp`, `malwareFamily`) was computed live from the actual text sent, not templated. Tested with 4 different payloads (SSH brute force, Cobalt Strike C2 beacon x2, a live Wazuh-alert-shaped brute force) and got 4 correctly differentiated results (T1110/Credential Access/MEDIUM, T1071/Command and Control/HIGH with `malwareFamily: "Cobalt Strike"` correctly extracted twice).
- Integrated: YES — writes real `Incident`/`IncidentEvidence` rows, reachable via `GET /ai/incidents`/`/ai/incidents/:id`.
- Tested: YES, live, multiple times, including through the real Wazuh-alert ingestion path.
- Result verified: YES.
- **Production concern:** Zero live-LLM testing was possible without a real API key (a decision the user made for this session — proceed with rule-based fallback). The rule-based path is honest and functional, but if the product's value proposition depends on real Claude analysis, that has never been demonstrated live in this repo, only asserted in code.

### Agent 2 — IOC_IOA_AGENT
- Exists: YES (`runDetection()` → `detection/indicator.util.ts`, `c2.util.ts`, `persistence.util.ts`)
- Runs: YES — automatically, synchronously right after every classification.
- Calls real AI: **NO — by design.** This is 100% deterministic regex/keyword matching; `generatedBy: 'deterministic'` is hardcoded in the code, not inferred. This is not a gap — the agent was never meant to call an LLM.
- Produces real output: YES — live test extracted `ip:198.51.100.23`, `ip:198.51.100.200`, `ip:198.51.100.201` correctly from the raw text sent, with a computed `confidence: 75`.
- Integrated: YES — writes real `Indicator`/`PersistenceFinding` rows, reachable via `GET /ai/incidents/:id/indicators` (confirmed live).
- Tested: YES, live.
- Result verified: YES.
- **Production concern:** None functional. The only concern is naming — calling a deterministic regex matcher an "AI Agent" alongside one that actually calls an LLM may create a mismatched expectation for stakeholders reading a feature list, even though the code itself is completely honest about what it does.

### Agent 3 — MITRE_RISK_AGENT
- Exists: YES (`RiskPredictionService.predict()`)
- Runs: **On-demand only** — not part of ingestion, only fires when a client calls `GET /ai/incidents/:id/investigation`.
- Calls real AI: **NO — by design.** Pure statistics (SELECT-only) over past incidents in the same department.
- Produces real output: YES — live test against a real incident returned `lateralMovementProbability: 98`, `estimatedAffectedDevices: 4`, `businessImpact: "HIGH"`, `confidence: 95`, computed from a real `sampleSize: 117` (117 real past department incidents), not a fixed/templated number.
- Integrated: YES — same `/investigation` endpoint, confirmed reachable.
- Tested: YES, live.
- Result verified: YES.
- **Production concern:** None functional. Explicitly never persisted (by design) — every call recomputes fresh from current data, which is correct for a risk score but means there's no historical record of what risk was predicted at incident-creation time.

### Agent 4 — RECOMMENDATION_AGENT
- Exists: YES (`buildRecommendations()`)
- Runs: Same on-demand `/investigation` call.
- Calls real AI: **NO — by design.** Pure aggregation over `IncidentAction.outcome` history of similar past incidents.
- Produces real output: **Empty (`[]`) in every live test performed this session** — this is documented, expected behavior ("there is no seeded history" per the code's own comment), not a bug. No `IncidentAction` in this environment has enough resolved-outcome history yet to generate a recommendation.
- Integrated: YES — same endpoint, correctly returns the empty array rather than erroring or fabricating a recommendation.
- Tested: YES, live — confirmed it returns empty rather than fake data.
- Result verified: YES (verified it correctly does *not* produce output yet, which is the correct behavior at this stage of the system's life).
- **Production concern:** This agent will keep returning nothing useful until real analysts log real `IncidentAction` outcomes over time in a pilot — worth setting that expectation explicitly rather than letting a pilot user assume it's broken.

## 4. End-to-End Incident Test

Two full chains were run live this session, both starting from a payload shaped exactly like a real Wazuh integration-script forward (not Mirqab's own `/ai/analyze` convenience endpoint), against a real registered Wazuh agent (`IT-SRV-01`, `active` on the real Wazuh Manager for this test):

**Chain A — SSH brute force (MEDIUM):**

| Step | Result |
|---|---|
| Event → Wazuh | **PARTIAL** — Wazuh itself wasn't the origin (no `mirqab-integration.py` installed, see Section 6); the payload was POSTed directly to Mirqab in the exact shape Wazuh's integration script would send |
| Wazuh → Mirqab (`POST /monitoring/wazuh`) | PASS — `201`, API-key-gated, real device resolved (`IT-SRV-01` → real seeded device, real department) |
| Detection/classification | PASS — `T1110 Brute Force`, `Credential Access`, correctly rule-based-classified from the raw log text |
| Incident creation | PASS — real `Incident` row, real case ID `INC-20260906-0003` |
| MITRE mapping | PASS — correct technique/tactic |
| Severity | PASS — `MEDIUM`, correctly below the auto-ticket threshold (`ticket: null`) |
| IOC extraction | PASS — `ip:203.0.113.77` correctly extracted |
| Notifications | PASS — real EMPLOYEE + ANALYST notification rows created with sensible generated text |
| Dashboard reachability | PASS (API-level) — incident immediately visible via `GET /ai/incidents/:id`; full UI render not confirmed (no browser tool) |

**Chain B — Cobalt Strike C2 beacon (HIGH):**

| Step | Result |
|---|---|
| Wazuh → Mirqab | PASS |
| Detection/classification | PASS — `T1071 Application Layer Protocol`, `Command and Control`, `malwareFamily: "Cobalt Strike"` correctly extracted from free text |
| Severity | PASS — `HIGH` |
| Auto-ticketing | PASS — `HIGH` correctly crossed the auto-ticket threshold; a real `Ticket` row was created (`ticketNumber: 164`) |
| Correlation | PASS — a second beacon alert on the same device within the correlation window correctly attached as evidence to the open case rather than creating a duplicate incident |
| MITRE/Recommendation | PASS — real `recommendedFixes` returned (block IP, capture traffic, isolate host) |
| **Device isolation** | **FAIL** — `POST /ai/incidents/:id/actions {"type":"ISOLATE_DEVICE"}` correctly triggered a real Active Response dispatch to the Wazuh Manager API, which the manager itself accepted, but the confirmation callback never arrived because the underlying `fetch()` call couldn't complete a TLS handshake — root-caused live to `ERR_TLS_CERT_ALTNAME_INVALID` (Wazuh Manager's auto-generated API cert has `subjectAltName: DNS:localhost` only; `WAZUH_API_URL` is configured as `https://host.docker.internal:55000`). The system correctly recorded a real `outcome: "FAILED"` — it never fabricated success, exactly as the code's own design comments claim. This is a **real, reproducible P0 bug blocking the isolation feature**, precisely diagnosed, not a vague "needs more testing." |
| Dashboard reachability | PASS (API-level) for the incident/ticket/action data; UI not visually confirmed |

**Error propagation / failure modes tested:**
- Invalid AI response: N/A this session (no live Claude call was possible; the rule-based path has no equivalent "invalid response" failure mode to trigger).
- Missing data (unregistered hostname): confirmed in Phase 13's prior work (not re-tested this session) — ingestion succeeds with `deviceId: null` rather than dropping the event.
- Redis/DB failure: not deliberately induced this session (would require stopping a live dependency mid-request — deferred as a Phase 10 stability observation instead of a destructive test).
- Duplicate/correlated processing: **confirmed working correctly** (Chain B's second beacon alert).

## 5. Open-Source Integration

| Component | Version (running) | Genuinely consumed by Mirqab? | Notes |
|---|---|---|---|
| Wazuh Manager | v4.14.7 | **YES** — real REST API calls (`logtest`, active-response, `/agents`) | Full healthy process table confirmed live |
| Wazuh Indexer (OpenSearch) | 4.14.7, green/healthy, 558 real alert docs | **NO** — Mirqab's backend never queries it (confirmed by grep + live behavior) | Pure Wazuh-stack overhead from Mirqab's own architecture's perspective; not a defect, just worth knowing it's not part of Mirqab's data path |
| Wazuh Dashboard | 4.14.7 (`stage: rc1` per Phase 5.5) | N/A — standalone Wazuh UI, not embedded in Mirqab | Port remapped to 8443 for this session, see Section 7 |
| `mirqab-integration.py` | n/a (custom script) | **NOT DEPLOYED** — confirmed absent from the live manager's `/var/ossec/integrations/` | The fully-automatic "real Wazuh alert fires → Mirqab ingests" path has never been demonstrated live in any session; only its manual-POST equivalent has |
| Anthropic Claude SDK | `@anthropic-ai/sdk` 0.115.0 | **Wired, zero live invocations** (no key) | Confirmed via live runtime log line, not just static reading |
| PostgreSQL | 16-alpine | **YES** — 405 real incidents, 15 devices, 5 users, 19 tables, migrations applied | Genuinely the system of record |
| Redis | 7-alpine | **YES** — live `ioredis` connections, active Socket.IO pub/sub channels | Cross-instance realtime broadcast confirmed real |
| Wazuh Agent (test) | 4.14.7, containerized | **YES**, added by this validation | Registered as `IT-SRV-01`, went `active`, used for the isolation test above |

## 6. Bugs Found

### P0 — Must fix before any deployment

1. **Incident list endpoint has no department-level access control (`GET /ai/incidents`).** Live-confirmed: an `IT_TECHNICIAN` scoped to Engineering retrieved a Finance-department incident's full content (title, description, root cause, resolution notes) through the plain list call, even though the exact same technician correctly gets `403` on `GET /ai/incidents/:id` for that same incident. Root cause: `ai.controller.ts`'s `listIncidents()` handler takes no user context and never invokes `IncidentAccessGuard`, unlike every other incident route. This is the same endpoint the code's own comments describe as the "OWASP API#1 fix" — the fix exists and works everywhere except here.
2. **Device isolation is non-functional as shipped** — `WazuhActiveResponseProvider`'s calls to the Wazuh Manager API fail TLS hostname verification (`ERR_TLS_CERT_ALTNAME_INVALID`: the manager's auto-generated cert SAN is `localhost` only, while `WAZUH_API_URL` uses `host.docker.internal`). The feature's own safety design (never report SUCCESS without a real callback) worked correctly and reported an honest `FAILED` — but the net effect is the flagship "Isolate" button cannot isolate anything against the stock Wazuh stack shipped in this repo.
3. **Live, unrotated secrets on disk** (carried over from Phase 5.5, re-confirmed still present): real `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`MONITORING_INGEST_API_KEY` in `infra/docker/.env`, and default Wazuh credentials (`API_PASSWORD=MyS3cr37P450r.*-`, `DASHBOARD_PASSWORD=kibanaserver`==username) in the vendored Wazuh stack, actively in use by the very stack this validation just ran.
4. **`backend` Docker image was stale** — the image running before this validation was built 2026-08-16 (three weeks old) and rejected a currently-valid API field (`AnalyzeLogDto.source`) as unrecognized. Fixed for this session by rebuilding (Section 7); flagging as P0 because if a deployment process doesn't rebuild the image on every deploy, it will silently run old code indefinitely.

### P1 — Must fix before company pilot

1. **`mirqab-integration.py` has never been installed on any Wazuh manager**, in this or any prior documented session — the fully-automatic "Wazuh detects → forwards → Mirqab ingests" path is unverified. Everything downstream of ingestion is proven live; the trigger itself is not.
2. **Employee-desktop's "AI Scan" does not call the backend or any AI at all** — it's a local hardcoded 3-item process-name watchlist, disclosed via `MockBadge` but not what a pilot user would expect from a feature named "AI Scan." Incident History also always includes 2 hardcoded fake incidents alongside real ones. Decide the intended pilot behavior before shipping this screen to real employees.
3. **Electron is 29.4.6 vs. current 44.x** (carried over from Phase 5.5) — materially past its security-support window on a product installed on employee endpoints.
4. **Wazuh dashboard's default port (443) collides with Mirqab's own nginx** when both stacks run together — the real deployment scenario. Fixed for this session (Section 7) but the upstream default should be revisited so a fresh clone doesn't hit the same failure.

### P2 — Should fix before production

1. **Wrong HTTP status codes on not-found/malformed incident IDs** (`500` instead of `404`/`400`) — `Prisma.findUniqueOrThrow` uncaught in the service layer. No information disclosure (the global exception filter correctly sanitizes the response), but it's a real correctness bug and pollutes error logs/monitoring with false "server error" noise.
2. **No `MaxLength` on `sourceExcerpt`** — a 100,000-character string was accepted without complaint. Not exploitable as tested, but worth a sane cap for storage/DoS hygiene.
3. **Backend Docker container runs as root** (carried over from Phase 5.5) — no `USER` directive despite the base image shipping a ready unprivileged user.
4. **Wazuh single-node stack pinned to a release candidate** (`4.14.7-rc1`, not GA).

### P3 — Future improvements

1. Duplicate password-hashing dependency (`bcrypt` + `bcryptjs`) — carried over from Phase 5.5.
2. No SAST/dependency/secret/container scanner wired into CI — carried over from Phase 5.5.
3. Consider whether calling `IOC_IOA_AGENT`/`MITRE_RISK_AGENT`/`RECOMMENDATION_AGENT` "AI Agents" (they are deterministic, by design) needs a documentation/marketing clarification even though the code itself is honest about it (`generatedBy: 'deterministic'`).
4. `RECOMMENDATION_AGENT` will return empty results until a pilot accumulates real `IncidentAction` outcome history — worth setting this expectation with pilot users up front rather than letting it look broken.

## 7. Changes Made During Validation

| File | Change | Why | Risk | Test performed | Result |
|---|---|---|---|---|---|
| `infra/docker/wazuh-docker/single-node/docker-compose.yml` | Remapped `wazuh.dashboard`'s host port from `443:5601` to `8443:5601`, with an inline comment explaining why | The upstream default collides with Mirqab's own nginx on host port 443 — both stacks together (the real deployment shape) can't start otherwise; confirmed via a real `"port is already allocated"` failure | Low — dev/test-only compose file, purely a host port number, fully reversible | Brought the dashboard container up after the change; reached `https://localhost:8443` successfully | Dashboard container starts and serves traffic; no functional change to Wazuh itself |
| `infra/docker/wazuh-docker/single-node/docker-compose.override.yml` | Updated the existing comment to point at the real fix location (Compose port lists append, not replace, across an override file, so the actual fix had to live in the base file instead) | Avoid a misleading override file that looks like it fixes the port but doesn't | None — comment-only | N/A | N/A |
| `infra/docker/wazuh-docker/single-node/config/wazuh_api_cert/wazuh-api-ca.pem` | Regenerated this locally-tracked copy of the Wazuh Manager API's self-signed certificate to match what the manager is currently actually serving (the previously-saved copy had a different fingerprint than the live-served cert, causing `DEPTH_ZERO_SELF_SIGNED_CERT`) | Needed to get past the *first* of two TLS errors blocking the isolation test, to reach and precisely diagnose the *second*, real one (hostname/SAN mismatch, documented as a P0 bug above rather than worked around) | Low — this file is explicitly a local, gitignored-adjacent dev artifact already designed to be regenerated per the existing volume-mount comment in `infra/docker/docker-compose.yml` | Re-ran the isolation test after regenerating | Got past the CA-trust error; the actual `ERR_TLS_CERT_ALTNAME_INVALID` root cause is now precisely diagnosed and documented above (P0 #2) rather than silently patched around |
| **Docker images rebuilt (not a file change, an operational step):** `docker compose build backend soc-dashboard` | Rebuilt both images from current source before testing | The previously-running images were three weeks stale and rejected a currently-valid API field | Low — standard rebuild, no source changed | Re-tested `/ai/analyze` after rebuild | Passed cleanly; flagged as its own P0 finding above since a deploy process that doesn't rebuild would silently run old code |

**Test data/state created during this validation (not code changes, noted for transparency — parent session/user should decide whether to clean these up):**
- 3 test user accounts: `test-employee@mirqab.local`, `test-tech-eng@mirqab.local`, `test-tech-fin@mirqab.local` (password `TestPass123!`), created to prove the RBAC bug live.
- Several test incidents/tickets created via live pipeline tests (case IDs `INC-20260906-0001` through `-0005` approximately).
- A real containerized Wazuh agent (`mirqab-safe-test-agent`, registered to the manager as `IT-SRV-01`) — still running.
- No production system, no external network target, and no destructive action was taken anywhere in this validation.

## 8. Deployment Recommendation

**Can I deploy Mirqab to a real company environment now? NO.**

**Exact blockers, in the order they'd need to be closed:**
1. Fix `GET /ai/incidents`'s missing department scoping (P0 #1) — this alone is a real, live-demonstrated confidentiality failure in a product whose entire value proposition is trustworthy access control over security data.
2. Fix or explicitly de-scope device isolation for the pilot (P0 #2) — either fix the Wazuh Manager API's certificate SAN, or clearly tell pilot users that the Isolate button doesn't work yet against the stock stack.
3. Rotate the live secrets and default Wazuh credentials currently in `infra/docker/.env` and the vendored Wazuh compose file (P0 #3) before this configuration touches anything beyond this local machine.
4. Put a rebuild step in whatever deployment process is used, so stale images (P0 #4) can't silently ship old code again.

None of these require redesigning anything — the underlying architecture, the AI agent design, the RBAC guard pattern, and the Wazuh integration contract are all sound and, in every case tested, either already correct (single-incident scoping, EMPLOYEE role blocking, rate limiting, CORS, input validation) or one narrow fix away from correct. Once the four items above are closed, this system is a strong candidate for an internal pilot — the P1/P2 items (Electron version, the never-installed Wazuh integration script, the employee-desktop mock features, error-code correctness) should be addressed before a *company-wide* pilot but don't block a small, supervised internal one.

Per the task's standing instruction: **no remediation has been performed for the bugs listed in Section 6** (only the narrow, documented environment-enablement fixes in Section 7, which were necessary to run and observe the system at all). This report stops here and awaits explicit approval before any fix is applied.
