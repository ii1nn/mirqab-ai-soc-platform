export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
  },
  cors: {
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
  },
  app: {
    // Base URL of the SOC Dashboard SPA — used to build the password-reset
    // link (see AuthService.forgotPassword). Falls back to the first CORS
    // origin so single-frontend deployments don't need a second env var.
    frontendUrl:
      process.env.APP_URL ??
      (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0].trim(),
  },
  claude: {
    // Unset by design in dev/CI — ClaudeService degrades to rule-based
    // triage when this is absent rather than failing requests.
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
    // Phase 8: Claude/Anthropic is an external cloud AI provider — Mirqab is
    // a SOC product handling customer security telemetry, which must never
    // leave the organization's environment in production. Setting
    // ANTHROPIC_API_KEY alone is no longer sufficient to activate Claude —
    // this second, explicitly-named flag must ALSO be set, so an operator
    // can never enable external AI by accident (e.g. copying a stray API key
    // into a production .env). Intended for local development/quality
    // comparison only — see MIRQAB-PHASE-8-SELF-HOSTED-AI-REPORT.md.
    allowExternalDevOnly: process.env.ALLOW_EXTERNAL_AI_DEV_ONLY === 'true',
    // Phase 9: explicit bound on the dev-only Claude client — see claude.service.ts.
    timeoutMs: parseInt(process.env.ANTHROPIC_TIMEOUT_MS ?? '30000', 10),
  },
  selfHostedAi: {
    // Phase 8: internal-only inference endpoint — never a client-suppliable
    // URL (see SelfHostedAiProvider). Unset by design until a real runtime
    // is deployed (see MIRQAB-PHASE-8-SELF-HOSTED-AI-REPORT.md's hardware
    // assessment for why none is deployed in this environment yet).
    baseUrl: process.env.SELF_HOSTED_AI_URL,
    model: process.env.SELF_HOSTED_AI_MODEL,
    timeoutMs: parseInt(process.env.SELF_HOSTED_AI_TIMEOUT_MS ?? '30000', 10),
  },
  monitoring: {
    // Shared secret presented by Wazuh/Suricata/Sysmon forwarders — these are
    // headless agents, not dashboard users, so they can't carry a JWT.
    ingestApiKey: process.env.MONITORING_INGEST_API_KEY,
  },
  redis: {
    // Unset by design in dev/single-instance deployments — RedisService
    // degrades to no cross-instance adapter when this is absent (see
    // src/redis/redis.service.ts), the same fallback pattern as the Claude API key.
    url: process.env.REDIS_URL,
  },
  wazuh: {
    // Unset by design — no Wazuh manager is deployed in this environment.
    // WazuhLogtestClient degrades to unavailable (see modules/monitoring/wazuh-logtest)
    // the same way ClaudeService does when ANTHROPIC_API_KEY is absent.
    apiUrl: process.env.WAZUH_API_URL,
    apiUser: process.env.WAZUH_API_USER,
    apiPassword: process.env.WAZUH_API_PASSWORD,
    // Real Wazuh on-demand Active Response script filename — NOT the
    // <command><name> from ossec.conf, and NOT an ar.conf-style
    // "name+timeout" identifier (both were tried and both produced a real
    // HTTP 400 from the Wazuh Manager API). Wazuh's own OpenAPI spec
    // documents the "command" field WazuhActiveResponseProvider sends
    // (always prefixed with "!") as: "If this value starts with '!', then
    // it refers to a script name instead of a command name." So this must
    // be the real <command><executable> value, e.g. "isolate-host.sh". See
    // WazuhActiveResponseProvider's doc comment.
    isolationCommand: process.env.WAZUH_ISOLATION_AR_COMMAND,
  },
  endpointControl: {
    // Unset by design — no real EDR/NAC endpoint-control provider is
    // deployed in this environment. EndpointControlService degrades to
    // unavailable the same way WazuhLogtestClient/ClaudeService do:
    // ISOLATE_DEVICE actions stay PENDING until an analyst manually
    // confirms the real-world result, rather than ever being marked
    // SUCCESS on the client's say-so.
    apiUrl: process.env.ENDPOINT_CONTROL_API_URL,
    apiKey: process.env.ENDPOINT_CONTROL_API_KEY,
  },
});
