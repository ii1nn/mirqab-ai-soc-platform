# Phase 5 — AI Engine

**Scope:** `backend/src/modules/ai/` — the full AI Features list from the
platform spec, implemented as a NestJS module (not the standalone
`ai-engine/` scaffold from Phase 1 — see Design decisions below). No SOC
Dashboard or Employee app changes.

## What was built

- **Claude integration** (`claude/`): `ClaudeService` wraps
  `@anthropic-ai/sdk`. Two call shapes: `generateStructured<T>()` (JSON-schema
  constrained via `output_config.format` — no tool-use loop needed for
  single-shot classification) and `generateText()` (for the notification and
  report generators). Model defaults to `claude-opus-5`, overridable via
  `ANTHROPIC_MODEL`. System prompts carry `cache_control: { type: "ephemeral" }`
  since each task type's prompt is identical across every call — real
  prompt-caching cost savings on repeat use. `stop_reason: "refusal"` raises
  a typed `ClaudeRefusalError`; no `ANTHROPIC_API_KEY` makes
  `isAvailable()` return `false`. Both are caught by `AiService` and trigger
  the rule-based fallback path — the API never fails a request for lack of a
  key.
- **MITRE ATT&CK mapping** (`mitre-attack/`): 12 real technique references
  (id/name/tactic/keywords) and a keyword-based `MitreMappingService`. Used
  standalone as the offline classifier, and to validate Claude's returned
  technique ID against a known set (`isKnownTechnique`) — a real safeguard
  against LLM hallucination, not just decoration.
- **Incident Similarity Engine** (`similarity-engine/`): `vector.util.ts`
  implements the "hashing trick" — tokens hashed into a fixed 256-dim
  vector, L2-normalized — and cosine similarity (= dot product on normalized
  vectors). This is an exact nearest-neighbor search, the same algorithm a
  FAISS `IndexFlatIP` runs, just without the native C++ dependency. See
  *Design decisions* below for why.
- **Orchestrator** (`ai.service.ts`): `analyzeLog()` runs the full pipeline —
  classify → severity → MITRE mapping → recommend fixes (static catalog
  keyed by technique ID) → persist `Incident` → auto-create `Ticket` when
  severity is HIGH/CRITICAL → index the embedding → generate an
  employee-friendly notification (Claude, or a plain-language template) and
  a brief analyst notification (deterministic, factual). `generateAnalystReport()`
  produces a technical Markdown report on demand (Claude at `effort: "high"`,
  or a templated fallback).
- **Prisma additions**: `Severity`, `IncidentStatus`, `TicketStatus`,
  `NotificationAudience` enums; `Incident`, `Ticket`, `IncidentMemory`,
  `Notification` models. `departmentId`/`deviceId` on `Incident` are plain
  optional strings, not relations — the Devices/Departments domain modules
  don't exist in the backend yet, so this stays decoupled (same pattern as
  `User` in Phase 2).
- **Endpoints**: `POST /ai/analyze`, `GET /ai/incidents`, `GET /ai/incidents/:id`,
  `GET /ai/incidents/:id/similar`, `POST /ai/incidents/:id/analyst-report` —
  all restricted to `ADMIN`/`SECURITY_ANALYST`/`IT_TECHNICIAN`.
- **Tests**: `mitre-mapping.service.spec.ts` (pure keyword-matching logic)
  and `ai.service.spec.ts` (the full rule-based pipeline — classification,
  severity assignment, auto-ticket threshold, both notification audiences —
  all with Claude mocked as unavailable, so no API key is needed to run
  `npm test`).

## Design decisions worth flagging

- **NestJS module, not the standalone `ai-engine/` folder from Phase 1.**
  That folder anticipated a possibly-Python FAISS microservice. Since FAISS's
  Python bindings (`faiss-cpu`) don't fit a Node/Docker deployment without a
  second language runtime and native compilation risk, and since the actual
  algorithm for exact search is straightforward to implement natively (see
  below), the AI engine lives in the main NestJS backend instead. The
  `ai-engine/` folder is left as-is for now; a future phase can repurpose or
  remove it.
- **FAISS-equivalent, not FAISS.** `faiss-node` (native bindings) is fragile
  to install reliably across Windows dev machines and Docker multi-stage
  builds. What FAISS's flat index actually does for exact search — brute-force
  inner-product comparison — is small enough to implement directly in
  TypeScript at a SOC's incident scale (thousands, not billions, of rows).
  This is documented in code and here so it's not mistaken for a shortcut:
  swap in real FAISS behind the same `SimilarityEngineService` interface if
  the corpus ever outgrows brute-force scanning.
- **No embeddings API.** Anthropic doesn't publish one, and reaching for a
  second provider (OpenAI, Voyage) would contradict the spec's "Claude API"
  requirement. The hashing-trick embedding is self-contained, deterministic,
  and needs no external call — Claude is used only for the generative tasks
  (classification text, notifications, reports), where it adds real value.
- **Graceful degradation is load-bearing, not decorative.** Every Claude call
  site has a genuinely usable fallback: rule-based MITRE matching + a tactic→severity
  heuristic for classification, a plain-language template for employee
  notifications, a templated Markdown skeleton for analyst reports. This was
  necessary because there's no way to verify a real `ANTHROPIC_API_KEY` is
  available in this environment — but it's also good production practice
  regardless (Claude API outages shouldn't take down incident triage).

## Next

Phase 6+: wire this into the SOC Dashboard (replace Simulation Mode's
client-side alert/incident generation with real `POST /ai/analyze` calls),
build the Devices/Departments/Policies/AuditLogs backend modules so
`Incident.departmentId`/`deviceId` can become real relations, and connect
the `websocket` module for real-time push instead of dashboard polling.
