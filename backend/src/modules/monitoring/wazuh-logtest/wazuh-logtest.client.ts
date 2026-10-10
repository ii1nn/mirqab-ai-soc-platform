import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogtestApiResponse, LogtestOutput, LogtestRequest } from './wazuh-logtest.types';

const TOKEN_SAFETY_MARGIN_MS = 30_000;

/**
 * Client for the real Wazuh Manager REST API's Logtest tool
 * (`POST /security/user/authenticate` + `PUT /logtest`, both documented in
 * wazuh/wazuh's `api/api/spec/spec.yaml` — see this module's `.types.ts` for
 * exact field provenance). Mirrors ClaudeService's degrade-gracefully shape:
 * `isAvailable()` is false whenever the three `WAZUH_API_*` env vars are
 * unset, and callers are expected to catch `run()` failures and fall back —
 * there is no Wazuh manager in this environment, so only the "unavailable"
 * path is exercised here; the request/response handling below is written
 * against the documented contract but has not been run against a live
 * manager (see docs/integrations/phase-3-wazuh-logtest-enrichment.md).
 */
@Injectable()
export class WazuhLogtestClient {
  private readonly logger = new Logger(WazuhLogtestClient.name);
  private readonly baseUrl: string | null;
  private readonly username?: string;
  private readonly password?: string;

  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>('wazuh.apiUrl');
    this.username = this.configService.get<string>('wazuh.apiUser');
    this.password = this.configService.get<string>('wazuh.apiPassword');
    this.baseUrl = baseUrl && this.username && this.password ? baseUrl.replace(/\/+$/, '') : null;

    if (!this.baseUrl) {
      this.logger.warn(
        'WAZUH_API_URL/WAZUH_API_USER/WAZUH_API_PASSWORD not fully set — Logtest enrichment disabled.',
      );
    }
  }

  isAvailable(): boolean {
    return this.baseUrl !== null;
  }

  /** Runs one line through the real Wazuh decode/rule-match pipeline. Throws on any failure —
   * always call this inside a try/catch and fall back, exactly like ClaudeService callers do. */
  async run(request: Omit<LogtestRequest, 'token'>): Promise<LogtestOutput> {
    if (!this.baseUrl) {
      throw new Error('Wazuh Logtest is not configured');
    }

    const token = await this.getToken();
    const response = await fetch(`${this.baseUrl}/logtest`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request satisfies LogtestRequest),
    });

    if (!response.ok) {
      throw new Error(`Wazuh Logtest request failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as LogtestApiResponse;
    if (body.error !== 0) {
      throw new Error(
        `Wazuh Logtest returned error code ${body.error}: ${body.data.messages?.join('; ')}`,
      );
    }
    if (!body.data.output) {
      throw new Error(
        "Wazuh Logtest returned no output — the line likely didn't match any decoder",
      );
    }

    return body.data.output;
  }

  /** `POST /security/user/authenticate` with HTTP Basic auth, per the documented contract —
   * tokens default to a 900s lifetime, cached here with a safety margin rather than re-authenticating per call. */
  private async getToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.token;
    }

    const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const response = await fetch(`${this.baseUrl}/security/user/authenticate`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!response.ok) {
      throw new Error(`Wazuh API authentication failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { data: { token: string }; error: number };
    if (body.error !== 0 || !body.data?.token) {
      throw new Error('Wazuh API authentication returned no token');
    }

    this.cachedToken = {
      token: body.data.token,
      expiresAt: Date.now() + 900_000 - TOKEN_SAFETY_MARGIN_MS,
    };
    return this.cachedToken.token;
  }
}
