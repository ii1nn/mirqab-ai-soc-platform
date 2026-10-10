import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  BCRYPT_SALT_ROUNDS: Joi.number().default(12),

  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),

  ADMIN_EMAIL: Joi.string().email({ tlds: false }).optional(),
  ADMIN_PASSWORD: Joi.string().min(8).optional(),

  // Optional by design: the AI engine falls back to rule-based triage when
  // unset. `.allow('')` matters here, not just `.optional()` — both
  // .env.example files ship this as `ANTHROPIC_API_KEY=` (present, empty),
  // and Joi treats a present-but-empty string as a validation failure unless
  // told otherwise, distinct from the key being absent entirely.
  ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
  ANTHROPIC_MODEL: Joi.string().default('claude-opus-5'),
  // Phase 8: a second, explicit opt-in required before Claude is ever used —
  // ANTHROPIC_API_KEY alone is no longer sufficient (see configuration.ts).
  ALLOW_EXTERNAL_AI_DEV_ONLY: Joi.string().valid('true', 'false').default('false'),
  // Phase 9: explicit request timeout for the dev-only Claude client.
  ANTHROPIC_TIMEOUT_MS: Joi.number().default(30000),

  // Phase 8: internal-only self-hosted inference endpoint. Optional — unset
  // means AiService falls back to deterministic rule-based triage, the same
  // fallback pattern as ANTHROPIC_API_KEY.
  SELF_HOSTED_AI_URL: Joi.string().allow('').optional(),
  SELF_HOSTED_AI_MODEL: Joi.string().allow('').optional(),
  SELF_HOSTED_AI_TIMEOUT_MS: Joi.number().default(30000),

  // Shared secret for the Wazuh/Suricata/Sysmon ingestion endpoints (see
  // modules/monitoring). Required — there is no rule-based fallback for auth.
  MONITORING_INGEST_API_KEY: Joi.string().min(16).required(),

  // Optional — unset (or empty, see ANTHROPIC_API_KEY above) means
  // RealtimeGateway runs single-instance with no cross-instance broadcast
  // adapter (see src/redis/redis.service.ts).
  REDIS_URL: Joi.string().allow('').optional(),

  // Optional — unset means WazuhLogtestClient degrades to unavailable, same
  // fallback pattern as ANTHROPIC_API_KEY (see modules/monitoring/wazuh-logtest).
  WAZUH_API_URL: Joi.string().allow('').optional(),
  WAZUH_API_USER: Joi.string().allow('').optional(),
  WAZUH_API_PASSWORD: Joi.string().allow('').optional(),
});
