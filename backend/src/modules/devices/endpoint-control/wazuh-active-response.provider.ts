import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Device } from '@prisma/client';
import { EndpointIsolationResult } from './endpoint-control.service';

const TOKEN_SAFETY_MARGIN_MS = 30_000;
/** How long isolate() waits for the agent's own script to call back and
 * confirm real execution before giving up and reporting FAILED. Phase 2 live
 * testing against a real manager + real agent (debug-level wazuh-remoted/
 * wazuh-execd logs) showed the manager does not push an on-demand Active
 * Response command to the agent immediately — delivery rides the agent's own
 * keep-alive/notify cycle (observed ~20s apart), so worst case an API call
 * landing just after one cycle waits nearly a full cycle before the agent
 * even sees it, before the script itself runs (observed a further ~6s for
 * isolate-host.sh's iptables-save + rule application). A real, successful
 * isolation was observed taking ~26-40s end-to-end this way — comfortably
 * over the previous 20s budget, which made a genuinely successful isolation
 * get reported as FAILED purely from waiting too little, not from anything
 * actually failing. 60s leaves real margin above the worst case observed. */
const EXECUTION_CONFIRMATION_TIMEOUT_MS = 60_000;

interface WazuhAgentListResponse {
  error: number;
  data?: { affected_items?: { id: string; name: string; status?: string }[] };
}

interface WazuhActiveResponseApiResponse {
  error: number;
  message?: string;
  data?: {
    affected_items?: unknown[];
    failed_items?: { error?: { message?: string } }[];
    total_affected_items?: number;
    total_failed_items?: number;
  };
}

/**
 * Real Wazuh Manager REST API client that triggers a genuine Active Response
 * command to isolate a device — not a simulation. Reuses the exact
 * auth contract already verified in WazuhLogtestClient (`POST
 * /security/user/authenticate` with HTTP Basic auth → cached bearer token),
 * and the `PUT /active-response?agents_list=<id>` + `GET /agents?name=<name>`
 * contracts as documented in Wazuh's own OpenAPI spec (`api/api/spec/spec.yaml`
 * in wazuh/wazuh) and https://documentation.wazuh.com/current/user-manual/api/reference.html
 * (verified against the published spec at implementation time — confirm
 * again against your installed manager's version before relying on this).
 *
 * This client *triggers* the Active Response command named by
 * `WAZUH_ISOLATION_AR_COMMAND`, then WAITS for the agent's own script to
 * call back and confirm it actually ran (see reportExecutionResult() and
 * backend/src/modules/devices/endpoint-control/endpoint-control.controller.ts) —
 * it never reports SUCCESS on the manager's "accepted and dispatched"
 * response alone. That distinction matters and was not theoretical: in
 * testing, the manager reported "dispatched, 0 failed items" while the
 * agent's script never actually ran (confirmed via the agent's own log file,
 * the manager's active-responses.log, and the live firewall state all
 * showing no execution) — this class exists specifically to close that gap.
 * If no callback arrives within EXECUTION_CONFIRMATION_TIMEOUT_MS, isolate()
 * returns success: false rather than assuming the isolation happened.
 *
 * `WAZUH_ISOLATION_AR_COMMAND` must be the real SCRIPT/EXECUTABLE filename
 * (<command><executable> in ossec.conf, e.g. "isolate-host.sh") — NOT the
 * <command><name>, and NOT an ar.conf-style "name+timeout" identifier.
 * Both of those were tried first and both produced a real, confirmed HTTP
 * 400 from the Wazuh Manager API: {"title": "Bad Request", "detail":
 * "'!<value>' is not a 'active_response_command' - 'command'"}. Wazuh's own
 * OpenAPI spec documents the "command" field (always sent here with a "!"
 * prefix) as: "If this value starts with '!', then it refers to a script
 * name instead of a command name" — i.e. the executable filename, not any
 * form of the command's registered name.
 *
 * Unavailable by design (same degrade-gracefully shape as
 * WazuhLogtestClient/ClaudeService) until all four of WAZUH_API_URL,
 * WAZUH_API_USER, WAZUH_API_PASSWORD, and WAZUH_ISOLATION_AR_COMMAND are set —
 * the last one only exists once a real Active Response command has actually
 * been written and registered on the manager, so this stays unavailable even
 * with real manager credentials until that step is done.
 */
@Injectable()
export class WazuhActiveResponseProvider {
  private readonly logger = new Logger(WazuhActiveResponseProvider.name);
  private readonly baseUrl: string | null;
  private readonly username?: string;
  private readonly password?: string;
  private readonly isolationCommand?: string;

  private cachedToken: { token: string; expiresAt: number } | null = null;

  /** Keyed by device hostname — a real callback from the agent's own script
   * (see endpoint-control.controller.ts) resolves the matching waiter here.
   * Single-in-flight-per-hostname is a safe assumption: the frontend already
   * disables the Isolate button while an action is pending on a device, so
   * there is never more than one outstanding isolate() call per hostname. */
  private readonly pendingConfirmations = new Map<
    string,
    (result: EndpointIsolationResult) => void
  >();

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>('wazuh.apiUrl');
    this.username = this.configService.get<string>('wazuh.apiUser');
    this.password = this.configService.get<string>('wazuh.apiPassword');
    this.isolationCommand = this.configService.get<string>('wazuh.isolationCommand');
    this.baseUrl =
      baseUrl && this.username && this.password && this.isolationCommand
        ? baseUrl.replace(/\/+$/, '')
        : null;

    if (!this.baseUrl) {
      this.logger.warn(
        'WAZUH_API_URL/WAZUH_API_USER/WAZUH_API_PASSWORD/WAZUH_ISOLATION_AR_COMMAND not fully set — ' +
          'Wazuh Active Response isolation is disabled.',
      );
    }
  }

  isAvailable(): boolean {
    return this.baseUrl !== null;
  }

  /** Throws on any failure — callers must catch and record IncidentActionOutcome.FAILED,
   * exactly like the generic EndpointControlService provider and WazuhLogtestClient do. */
  async isolate(device: Device): Promise<EndpointIsolationResult> {
    if (!this.baseUrl) {
      throw new Error('Wazuh Active Response is not configured');
    }

    const token = await this.getToken();
    const agentId = await this.resolveAgentId(device.hostname, token);

    const response = await fetch(
      `${this.baseUrl}/active-response?agents_list=${encodeURIComponent(agentId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // Leading "!" is required by Wazuh for a custom command invoked
        // on-demand via the API rather than fired automatically by a rule
        // match — see the spec's ActiveResponseBody schema.
        body: JSON.stringify({ command: `!${this.isolationCommand}`, arguments: [] }),
      },
    );

    if (!response.ok) {
      // TEMPORARY DIAGNOSTIC — captures Wazuh's actual response body instead
      // of discarding it, so the real validation error (not just the status
      // code) ends up in the IncidentAction.notes this already writes to on
      // failure. Remove once the real HTTP 400 cause is confirmed and fixed.
      const bodyText = await response.text().catch(() => '<failed to read response body>');
      throw new Error(`Wazuh Active Response request failed: HTTP ${response.status} — body: ${bodyText}`);
    }

    const body = (await response.json()) as WazuhActiveResponseApiResponse;
    if (body.error !== 0) {
      throw new Error(`Wazuh Active Response returned error code ${body.error}: ${body.message}`);
    }

    const failedItems = body.data?.failed_items ?? [];
    const dispatched = (body.data?.total_affected_items ?? 0) > 0;
    if (!dispatched || failedItems.length > 0) {
      // The manager itself refused/failed to dispatch — no point waiting for
      // a callback that can never arrive.
      return {
        success: false,
        detail: `Wazuh Active Response was not successfully dispatched: ${
          failedItems[0]?.error?.message ?? body.message ?? 'no affected items reported'
        }`,
      };
    }

    // Dispatch alone is NOT success — see class doc comment. Wait for the
    // agent's own script to call back and confirm it actually ran the
    // isolation logic before reporting anything but a genuine, evidenced
    // outcome.
    return this.waitForExecutionConfirmation(device.hostname, agentId);
  }

  /** Resolves the pending isolate() call for this hostname, if any. Called
   * by EndpointControlController when the agent's own script reports its
   * real result. Returns false (and logs) if there was no matching waiter —
   * e.g. a late callback after the timeout already gave up, or a callback
   * for a hostname nobody is isolating right now. Either way this is never
   * treated as an error the caller needs to handle: a stray/late callback
   * changes nothing about an isolation this class already resolved. */
  reportExecutionResult(hostname: string, success: boolean, detail?: string): boolean {
    const resolve = this.pendingConfirmations.get(hostname);
    if (!resolve) {
      this.logger.warn(
        `Received an Active Response execution callback for "${hostname}" with no matching pending isolate() call — ignoring (likely arrived after the confirmation timeout, or for a hostname not currently being isolated).`,
      );
      return false;
    }

    this.pendingConfirmations.delete(hostname);
    resolve({
      success,
      detail:
        detail ??
        (success
          ? `Agent "${hostname}" confirmed it executed the isolation script.`
          : `Agent "${hostname}" reported the isolation script did not complete successfully.`),
    });
    return true;
  }

  private waitForExecutionConfirmation(
    hostname: string,
    agentId: string,
  ): Promise<EndpointIsolationResult> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: EndpointIsolationResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingConfirmations.delete(hostname);
        resolve(result);
      };

      const timer = setTimeout(() => {
        settle({
          success: false,
          detail:
            `Wazuh accepted and dispatched the Active Response command to agent ${agentId} (${hostname}), ` +
            `but no execution confirmation callback was received from the agent within ${
              EXECUTION_CONFIRMATION_TIMEOUT_MS / 1000
            }s. Treating this as failed rather than assuming the isolation happened — verify the agent is ` +
            'reachable and that its script is correctly configured to call back.',
        });
      }, EXECUTION_CONFIRMATION_TIMEOUT_MS);

      this.pendingConfirmations.set(hostname, settle);
    });
  }

  /** `GET /agents?name=<hostname>` — the same hostname convention already
   * used for alert-based device resolution (see DevicesService.findByHostname),
   * so a Wazuh agent must be registered under the exact same name as
   * Device.hostname for this to find it. Throws (not a soft failure) when no
   * agent is found — there is nothing to isolate. */
  private async resolveAgentId(hostname: string, token: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/agents?name=${encodeURIComponent(hostname)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Wazuh agent lookup failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as WazuhAgentListResponse;
    const agent = body.data?.affected_items?.[0];
    if (!agent) {
      throw new Error(
        `No Wazuh agent is registered under hostname "${hostname}" — cannot isolate an endpoint Wazuh doesn't know about.`,
      );
    }
    if (agent.status && agent.status !== 'active') {
      throw new Error(
        `Wazuh agent for "${hostname}" is registered but not active (status: ${agent.status}) — it cannot receive an Active Response command right now.`,
      );
    }

    return agent.id;
  }

  /** `POST /security/user/authenticate` with HTTP Basic auth — identical
   * contract to WazuhLogtestClient.getToken(), duplicated rather than shared
   * so this module has no dependency on modules/monitoring (additive, no
   * existing module touched). Tokens default to a 900s lifetime. */
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
