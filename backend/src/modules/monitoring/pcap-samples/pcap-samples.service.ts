import { Injectable, Logger } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { MonitoringService } from '../monitoring.service';
import { loadPcapSampleEvents } from './pcap-samples.data';
import { parsePcapSampleEvent } from './pcap-sample.parser';

const DATASET_ORIGIN = 'PcapMonkey';

/** Demo-only trigger, mirrors WazuhSamplesService/LoghubSamplesService: replays the
 * real, on-disk Zeek/ECS sample events (datasets/PcapMonkey/zeek-sample-events.json)
 * through the real ingestPcap() -> analyzeLog() path. */
@Injectable()
export class PcapSamplesService {
  private readonly logger = new Logger(PcapSamplesService.name);

  constructor(private readonly monitoringService: MonitoringService) {}

  async seed() {
    let events: ReturnType<typeof loadPcapSampleEvents>;
    try {
      events = loadPcapSampleEvents();
    } catch (error) {
      this.logger.error(
        `Could not read datasets/${DATASET_ORIGIN} — no incidents ingested: ${error instanceof Error ? error.message : error}`,
      );
      return {
        ingested: 0,
        incidents: [],
        error: `Could not read the real dataset file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const ingested: Array<{
      dataset: string;
      sourceIp: string;
      incidentId: string;
      caseId: string;
      severity: string;
      mitreTechniqueId: string;
      ticketCreated: boolean;
    }> = [];

    for (const raw of events) {
      const event = parsePcapSampleEvent(raw);
      const result = await this.monitoringService.ingestPcap(event, {
        ingestSource: EventSource.OPEN_SOURCE_DATASET,
        datasetOrigin: DATASET_ORIGIN,
        rawEvent: raw.raw,
      });
      ingested.push({
        dataset: event.dataset,
        sourceIp: event.sourceIp,
        incidentId: result.incident.id,
        caseId: result.incident.caseId,
        severity: result.incident.severity,
        mitreTechniqueId: result.incident.mitreTechniqueId,
        ticketCreated: result.ticket !== null,
      });
    }

    return { ingested: ingested.length, totalEvents: events.length, incidents: ingested };
  }
}
