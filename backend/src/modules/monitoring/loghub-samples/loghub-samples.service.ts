import { Injectable, Logger } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { MonitoringService } from '../monitoring.service';
import { SyslogEventDto } from '../dto/syslog-event.dto';
import { WazuhLogtestClient } from '../wazuh-logtest/wazuh-logtest.client';
import {
  loadLoghubApacheLines,
  loadLoghubLinuxLines,
  loadLoghubSshLines,
} from './loghub-samples.data';
import { parseLoghubSampleLine } from './loghub-sample-log.parser';

const DATASET_ORIGIN = 'loghub';

/**
 * Demo-only trigger, mirrors WazuhSamplesService (Integration Phase 1): replays the
 * bundled LogHub excerpt through the real ingestSyslog() -> analyzeLog() path.
 *
 * Integration Phase 3 addition: SSH/Linux lines (standard syslog format) are
 * first offered to the real Wazuh Logtest API as `log_format: "syslog"`.
 * When a manager is configured and reachable, its real decoded rule/MITRE
 * mapping enriches `summary` before ingestSyslog() builds the excerpt.
 * Apache's error-log format has no matching entry in Logtest's documented
 * `log_format` enum, so it always uses the heuristic parser only — a real
 * limitation, not an oversight (see docs/integrations/phase-3-wazuh-logtest-enrichment.md).
 */
@Injectable()
export class LoghubSamplesService {
  private readonly logger = new Logger(LoghubSamplesService.name);

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly logtestClient: WazuhLogtestClient,
  ) {}

  async seed() {
    let categories: Array<{ category: 'ssh' | 'linux' | 'apache'; lines: string[] }>;
    try {
      categories = [
        { category: 'ssh', lines: loadLoghubSshLines() },
        { category: 'linux', lines: loadLoghubLinuxLines() },
        { category: 'apache', lines: loadLoghubApacheLines() },
      ];
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
      category: string;
      host: string;
      incidentId: string;
      caseId: string;
      severity: string;
      mitreTechniqueId: string;
      ticketCreated: boolean;
      enrichedByLogtest: boolean;
    }> = [];
    let skipped = 0;
    let totalLines = 0;

    for (const { category, lines } of categories) {
      totalLines += lines.length;
      for (const line of lines) {
        const heuristic = parseLoghubSampleLine(line, category);
        if (!heuristic) {
          skipped += 1;
          this.logger.warn(
            `Could not parse bundled ${category} line, skipping: ${line.slice(0, 80)}...`,
          );
          continue;
        }

        const { event, enriched } = await this.enrichWithLogtest(line, category, heuristic);
        const result = await this.monitoringService.ingestSyslog(event, {
          ingestSource: EventSource.OPEN_SOURCE_DATASET,
          datasetOrigin: DATASET_ORIGIN,
          rawEvent: line,
        });
        ingested.push({
          category,
          host: event.host,
          incidentId: result.incident.id,
          caseId: result.incident.caseId,
          severity: result.incident.severity,
          mitreTechniqueId: result.incident.mitreTechniqueId,
          ticketCreated: result.ticket !== null,
          enrichedByLogtest: enriched,
        });
      }
    }

    return { ingested: ingested.length, skipped, totalLines, incidents: ingested };
  }

  /** Returns the heuristic event unchanged unless a configured, reachable Logtest
   * call produces a real rule match — never throws, always falls back on failure. */
  private async enrichWithLogtest(
    rawLine: string,
    category: 'ssh' | 'linux' | 'apache',
    heuristic: SyslogEventDto,
  ): Promise<{ event: SyslogEventDto; enriched: boolean }> {
    if (category === 'apache' || !this.logtestClient.isAvailable()) {
      return { event: heuristic, enriched: false };
    }

    try {
      const output = await this.logtestClient.run({
        log_format: 'syslog',
        location: 'loghub-samples-demo',
        event: rawLine,
      });

      if (!output.rule) {
        return { event: heuristic, enriched: false };
      }

      const mitre = output.rule.mitre;
      const mitreSuffix = mitre?.technique?.length
        ? ` MITRE ATT&CK: ${mitre.technique.join(', ')} (${(mitre.id ?? []).join(', ')}).`
        : '';

      return {
        event: {
          host: heuristic.host,
          program: heuristic.program,
          summary: `${output.rule.description}${mitreSuffix}`,
          rawLine: output.full_log ?? rawLine,
          timestamp: heuristic.timestamp,
        },
        enriched: true,
      };
    } catch (error) {
      this.logger.warn(
        `Wazuh Logtest enrichment failed, using heuristic decode: ${error instanceof Error ? error.message : error}`,
      );
      return { event: heuristic, enriched: false };
    }
  }
}
