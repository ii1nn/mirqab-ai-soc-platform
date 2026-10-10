import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Device } from '@prisma/client';
import { WazuhActiveResponseProvider } from './wazuh-active-response.provider';

export interface EndpointIsolationResult {
  success: boolean;
  detail: string;
}

/**
 * Integration point for a real EDR/NAC endpoint-control provider capable of
 * actually cutting a device's network access. Two real providers are
 * supported, tried in this order:
 *
 * 1. Wazuh Active Response (`WazuhActiveResponseProvider`) — used when
 *    WAZUH_API_URL/WAZUH_API_USER/WAZUH_API_PASSWORD/WAZUH_ISOLATION_AR_COMMAND
 *    are all set, i.e. a real Wazuh manager is reachable AND a real custom
 *    isolation Active Response command has been registered on it (see
 *    infra/monitoring/wazuh/active-response/).
 * 2. A generic REST provider (`POST {ENDPOINT_CONTROL_API_URL}/isolate`) —
 *    used when ENDPOINT_CONTROL_API_URL/ENDPOINT_CONTROL_API_KEY are set,
 *    for any other EDR/NAC/firewall product with its own isolation API.
 *
 * If neither is configured, degrades to `isAvailable() === false` exactly
 * like ClaudeService/WazuhLogtestClient. AiService.createIncidentAction uses
 * that to leave an ISOLATE_DEVICE action PENDING (the analyst must perform
 * the isolation out-of-band and confirm the real-world result themselves via
 * updateIncidentAction) rather than ever fabricating a SUCCESS outcome.
 */
@Injectable()
export class EndpointControlService {
  private readonly logger = new Logger(EndpointControlService.name);
  private readonly baseUrl: string | null;
  private readonly apiKey?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly wazuh: WazuhActiveResponseProvider,
  ) {
    const baseUrl = this.configService.get<string>('endpointControl.apiUrl');
    this.apiKey = this.configService.get<string>('endpointControl.apiKey');
    this.baseUrl = baseUrl && this.apiKey ? baseUrl.replace(/\/+$/, '') : null;

    if (!this.baseUrl && !this.wazuh.isAvailable()) {
      this.logger.warn(
        'No endpoint-control provider configured (neither Wazuh Active Response nor ' +
          'ENDPOINT_CONTROL_API_URL/API_KEY) — automated device isolation is disabled; ISOLATE_DEVICE actions require manual analyst confirmation.',
      );
    }
  }

  isAvailable(): boolean {
    return this.wazuh.isAvailable() || this.baseUrl !== null;
  }

  /** Calls the real endpoint-control provider to isolate a device. Throws on
   * any failure — callers must catch and record IncidentActionOutcome.FAILED,
   * exactly like ClaudeService/WazuhLogtestClient callers do. */
  async isolate(device: Device): Promise<EndpointIsolationResult> {
    if (this.wazuh.isAvailable()) {
      return this.wazuh.isolate(device);
    }

    if (!this.baseUrl) {
      throw new Error('Endpoint control provider is not configured');
    }

    const response = await fetch(`${this.baseUrl}/isolate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hostname: device.hostname, ipAddress: device.ipAddress }),
    });

    if (!response.ok) {
      throw new Error(`Endpoint control provider returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as { success: boolean; detail?: string };
    return { success: body.success, detail: body.detail ?? 'Isolation request accepted' };
  }
}
