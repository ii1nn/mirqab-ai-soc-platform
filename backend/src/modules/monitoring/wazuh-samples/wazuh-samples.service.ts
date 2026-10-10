import { Injectable, Logger } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { MonitoringService } from '../monitoring.service';
import { WazuhAlertDto } from '../dto/wazuh-alert.dto';
import { WazuhLogtestClient } from '../wazuh-logtest/wazuh-logtest.client';
import { loadWazuhSampleLines } from './wazuh-samples.data';
import { parseWazuhSampleLine } from './wazuh-sample-log.parser';

const DATASET_ORIGIN = 'wazuh-sample-logs';

/**
 * Demo-only trigger: replays the bundled wazuh-sample-logs excerpt (see
 * datasets/wazuh-sample-logs) through the exact same ingestWazuh() path a
 * live Wazuh manager's integration script would call — no separate storage
 * or classification logic, just the missing "raw sample -> Wazuh alert
 * shape" step in front of the existing pipeline.
 *
 * Integration Phase 3 addition: before building that alert, each line is
 * first offered to the real Wazuh Logtest API. When a manager is configured
 * and reachable, its real decoded rule id/level/description/MITRE mapping
 * replace the heuristic guess from wazuh-sample-log.parser.ts. When it's
 * not (this environment, always), that heuristic parser is the fallback —
 * exactly Phase 1's original behavior, unchanged.
 */
@Injectable()
export class WazuhSamplesService {
  private readonly logger = new Logger(WazuhSamplesService.name);

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly logtestClient: WazuhLogtestClient,
  ) {}

  async seed() {
    let lines: string[];
    try {
      lines = loadWazuhSampleLines();
    } catch (error) {
      this.logger.error(
        `Could not read datasets/${DATASET_ORIGIN} — no incidents ingested: ${error instanceof Error ? error.message : error}`,
      );
      return {
        ingested: 0,
        incidents: [],
        error: `Could not read the real dataset files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const ingested: Array<{
      agent: string;
      incidentId: string;
      caseId: string;
      severity: string;
      ticketCreated: boolean;
      enrichedByLogtest: boolean;
    }> = [];
    let skipped = 0;

    for (const line of lines) {
      const heuristic = parseWazuhSampleLine(line);
      if (!heuristic) {
        skipped += 1;
        this.logger.warn(`Could not parse bundled sample line, skipping: ${line.slice(0, 80)}...`);
        continue;
      }

      const { alert, enriched } = await this.enrichWithLogtest(line, heuristic);
      const result = await this.monitoringService.ingestWazuh(alert, {
        ingestSource: EventSource.OPEN_SOURCE_DATASET,
        datasetOrigin: DATASET_ORIGIN,
        rawEvent: line,
      });
      ingested.push({
        agent: alert.agent.name,
        incidentId: result.incident.id,
        caseId: result.incident.caseId,
        severity: result.incident.severity,
        ticketCreated: result.ticket !== null,
        enrichedByLogtest: enriched,
      });
    }

    return { ingested: ingested.length, skipped, totalLines: lines.length, incidents: ingested };
  }

  /** Returns the heuristic alert unchanged unless a configured, reachable Logtest
   * call produces a real rule match — never throws, always falls back on failure. */
  private async enrichWithLogtest(
    rawLine: string,
    heuristic: WazuhAlertDto,
  ): Promise<{ alert: WazuhAlertDto; enriched: boolean }> {
    if (!this.logtestClient.isAvailable()) {
      return { alert: heuristic, enriched: false };
    }

    try {
      const logFormat = rawLine.trim().startsWith('{') ? 'json' : 'syslog';
      const output = await this.logtestClient.run({
        log_format: logFormat,
        location: 'wazuh-samples-demo',
        event: rawLine,
      });

      if (!output.rule) {
        return { alert: heuristic, enriched: false };
      }

      const mitre = output.rule.mitre;
      const mitreSuffix = mitre?.technique?.length
        ? ` MITRE ATT&CK: ${mitre.technique.join(', ')} (${(mitre.id ?? []).join(', ')}).`
        : '';

      return {
        alert: {
          rule: {
            id: String(output.rule.id),
            level: output.rule.level,
            description: `${output.rule.description}${mitreSuffix}`,
          },
          agent: heuristic.agent,
          full_log: output.full_log ?? rawLine,
          location: heuristic.location,
        },
        enriched: true,
      };
    } catch (error) {
      this.logger.warn(
        `Wazuh Logtest enrichment failed, using heuristic decode: ${error instanceof Error ? error.message : error}`,
      );
      return { alert: heuristic, enriched: false };
    }
  }
}
