import { Injectable, Logger } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { readdirSync } from 'fs';
import { AiService } from '../../ai/ai.service';
import { DevicesService } from '../../devices/devices.service';
import { datasetPath } from '../dataset-path.util';
import { isWevtutilAvailable, parseEvtxFile } from './evtx-parser.util';

const DATASET_ORIGIN = 'EVTX-to-MITRE-Attack';

/**
 * Demo-only trigger, same shape as WazuhSamplesService/LoghubSamplesService/
 * PcapSamplesService, for the one dataset none of those three could reach:
 * datasets/EVTX-to-MITRE-Attack's binary Windows Event Log file. There is no
 * vendor DTO for this (a real deployment would forward Sysmon/Security
 * events as structured JSON via /monitoring/sysmon, not raw .evtx), so this
 * calls AiService.analyzeLog() directly rather than going through
 * MonitoringService — same real end-of-pipeline, one less layer of
 * indirection since there's no vendor-shape translation needed here.
 *
 * Decoding happens via Windows' own native `wevtutil` (see evtx-parser.util)
 * — Windows-only. On a non-Windows host (e.g. this project's Linux
 * production containers) this degrades to a clear, honest "cannot parse"
 * result. It never fabricates an incident to paper over that gap.
 */
@Injectable()
export class EvtxSamplesService {
  private readonly logger = new Logger(EvtxSamplesService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly devicesService: DevicesService,
  ) {}

  async seed() {
    if (!isWevtutilAvailable()) {
      return {
        ingested: 0,
        incidents: [],
        error:
          'EVTX parsing requires the Windows-native "wevtutil" tool, only available on Windows ' +
          'hosts. This environment cannot decode the binary .evtx file — no incidents were ' +
          'fabricated in its place. Insufficient evidence.',
      };
    }

    let files: string[];
    try {
      files = readdirSync(datasetPath(DATASET_ORIGIN)).filter((f) =>
        f.toLowerCase().endsWith('.evtx'),
      );
    } catch (error) {
      this.logger.error(
        `Could not read datasets/${DATASET_ORIGIN}: ${error instanceof Error ? error.message : error}`,
      );
      return {
        ingested: 0,
        incidents: [],
        error: `Could not read the dataset directory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const ingested: Array<{
      file: string;
      eventId: string;
      incidentId: string;
      caseId: string;
      severity: string;
      ticketCreated: boolean;
    }> = [];

    for (const file of files) {
      let events;
      try {
        events = await parseEvtxFile(datasetPath(DATASET_ORIGIN, file));
      } catch (error) {
        this.logger.warn(
          `Could not parse ${file}, skipping: ${error instanceof Error ? error.message : error}`,
        );
        continue;
      }

      for (const evt of events) {
        const deviceId = await this.resolveDeviceId(evt.computer);
        const sourceExcerpt = [
          `Windows Event ${evt.eventId} (${evt.logName}) on ${evt.computer || 'unknown host'} at ${evt.date}`,
          evt.description,
        ]
          .filter(Boolean)
          .join('\n');

        const result = await this.aiService.analyzeLog({
          sourceExcerpt,
          deviceId,
          rawEvent: evt.raw,
          ingestSource: EventSource.OPEN_SOURCE_DATASET,
          datasetOrigin: DATASET_ORIGIN,
        });
        ingested.push({
          file,
          eventId: evt.eventId,
          incidentId: result.incident.id,
          caseId: result.incident.caseId,
          severity: result.incident.severity,
          ticketCreated: result.ticket !== null,
        });
      }
    }

    return { ingested: ingested.length, incidents: ingested };
  }

  /** The EVTX Computer field is typically an FQDN (e.g. "FS03.offsec.lan") —
   * tries the exact value, then the short hostname, same "return undefined
   * rather than reject" fallback contract MonitoringService's resolvers use. */
  private async resolveDeviceId(computer: string): Promise<string | undefined> {
    if (!computer) return undefined;
    const exact = await this.devicesService.findByHostname(computer);
    if (exact) return exact.id;
    const shortName = computer.split('.')[0];
    const short = shortName !== computer ? await this.devicesService.findByHostname(shortName) : null;
    return short?.id;
  }
}
