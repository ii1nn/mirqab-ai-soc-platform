import { Injectable, Logger } from '@nestjs/common';
import { EventSource } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { DevicesService } from '../devices/devices.service';
import { PcapEventDto } from './dto/pcap-event.dto';
import { SuricataAlertDto } from './dto/suricata-alert.dto';
import { SyslogEventDto } from './dto/syslog-event.dto';
import { SysmonEventDto } from './dto/sysmon-event.dto';
import { WazuhAlertDto } from './dto/wazuh-alert.dto';
import { sysmonEventName } from './sysmon-event-names.data';

/**
 * Provenance a caller can attach to an ingestX() call — never accepted from
 * the public HTTP DTOs themselves (a client can't self-declare "I'm a real
 * dataset"), only passed in-process by trusted server-side callers: the
 * *-samples/seed services (OPEN_SOURCE_DATASET) and this module's own
 * controller (implicitly LIVE_AGENT, the default below). `rawEvent`, when
 * given, overrides the raw text this method would otherwise extract from the
 * DTO itself — used when the caller already has the true original record
 * (e.g. a full raw ECS JSON blob PcapEventDto doesn't carry end-to-end).
 */
export interface IngestMeta {
  ingestSource?: EventSource;
  datasetOrigin?: string;
  rawEvent?: string;
}

/**
 * Normalizes each vendor's native alert shape into the plain-text log excerpt
 * `AiService.analyzeLog()` already expects — the same entry point Simulation
 * Mode's event generator calls (see docs/phases/phase-6.md). Real telemetry
 * and simulated telemetry both end up on the one detection/triage path; this
 * module's only job is the vendor-specific normalization, not re-implementing
 * classification.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly devicesService: DevicesService,
  ) {}

  async ingestWazuh(dto: WazuhAlertDto, meta?: IngestMeta) {
    const sourceExcerpt = [
      `Wazuh rule ${dto.rule.id} (level ${dto.rule.level}): ${dto.rule.description}`,
      dto.location ? `Location: ${dto.location}` : null,
      `Log: ${dto.full_log}`,
    ]
      .filter(Boolean)
      .join('\n');

    const deviceId = await this.resolveDeviceId(dto.agent.name);
    return this.aiService.analyzeLog({
      sourceExcerpt,
      deviceId,
      rawEvent: meta?.rawEvent ?? dto.full_log,
      ingestSource: meta?.ingestSource ?? EventSource.LIVE_AGENT,
      datasetOrigin: meta?.datasetOrigin,
    });
  }

  async ingestSuricata(dto: SuricataAlertDto, meta?: IngestMeta) {
    const sourceExcerpt = [
      `Suricata alert: ${dto.alert.signature}`,
      dto.alert.category ? `Category: ${dto.alert.category}` : null,
      `Severity: ${dto.alert.severity}`,
      `${dto.src_ip} -> ${dto.dest_ip}${dto.proto ? ` (${dto.proto})` : ''}`,
    ]
      .filter(Boolean)
      .join('\n');

    const deviceId = await this.resolveDeviceId(dto.host);
    return this.aiService.analyzeLog({
      sourceExcerpt,
      deviceId,
      rawEvent: meta?.rawEvent ?? JSON.stringify(dto),
      ingestSource: meta?.ingestSource ?? EventSource.LIVE_AGENT,
      datasetOrigin: meta?.datasetOrigin,
    });
  }

  async ingestSysmon(dto: SysmonEventDto, meta?: IngestMeta) {
    const sourceExcerpt = [
      `Sysmon ${sysmonEventName(dto.EventID)} on ${dto.Computer}`,
      dto.User ? `User: ${dto.User}` : null,
      dto.Image ? `Image: ${dto.Image}` : null,
      dto.CommandLine ? `Command line: ${dto.CommandLine}` : null,
      dto.ParentImage ? `Parent image: ${dto.ParentImage}` : null,
      dto.TargetFilename ? `Target file: ${dto.TargetFilename}` : null,
      dto.DestinationIp
        ? `Destination: ${dto.DestinationIp}${dto.DestinationPort ? `:${dto.DestinationPort}` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const deviceId = await this.resolveDeviceId(dto.Computer);
    return this.aiService.analyzeLog({
      sourceExcerpt,
      deviceId,
      rawEvent: meta?.rawEvent ?? JSON.stringify(dto),
      ingestSource: meta?.ingestSource ?? EventSource.LIVE_AGENT,
      datasetOrigin: meta?.datasetOrigin,
    });
  }

  async ingestSyslog(dto: SyslogEventDto, meta?: IngestMeta) {
    const sourceExcerpt = [
      `Syslog (${dto.program}) on ${dto.host}: ${dto.summary}`,
      dto.timestamp ? `Time: ${dto.timestamp}` : null,
      `Raw: ${dto.rawLine}`,
    ]
      .filter(Boolean)
      .join('\n');

    const deviceId = await this.resolveDeviceId(dto.host);
    return this.aiService.analyzeLog({
      sourceExcerpt,
      deviceId,
      rawEvent: meta?.rawEvent ?? dto.rawLine,
      ingestSource: meta?.ingestSource ?? EventSource.LIVE_AGENT,
      datasetOrigin: meta?.datasetOrigin,
    });
  }

  async ingestPcap(dto: PcapEventDto, meta?: IngestMeta) {
    const sourceExcerpt = [
      `Network event (${dto.dataset}): ${dto.detail ?? 'no additional detail'}`,
      `${dto.sourceIp}${dto.sourcePort ? `:${dto.sourcePort}` : ''} -> ${dto.destinationIp ?? 'unknown'}${
        dto.destinationPort ? `:${dto.destinationPort}` : ''
      }${dto.transport ? ` (${dto.transport})` : ''}`,
      dto.timestamp ? `Time: ${dto.timestamp}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const deviceId = await this.resolveDeviceIdByIp(dto.sourceIp);
    return this.aiService.analyzeLog({
      sourceExcerpt,
      deviceId,
      rawEvent: meta?.rawEvent ?? JSON.stringify(dto),
      ingestSource: meta?.ingestSource ?? EventSource.LIVE_AGENT,
      datasetOrigin: meta?.datasetOrigin,
    });
  }

  /** Falls back to no device rather than rejecting the event — an alert from an
   * unenrolled host is still real and worth triaging, just without department context. */
  private async resolveDeviceId(hostname: string): Promise<string | undefined> {
    const device = await this.devicesService.findByHostname(hostname);
    if (!device) {
      this.logger.warn(
        `No registered device for hostname "${hostname}" — ingesting without device context`,
      );
      return undefined;
    }
    return device.id;
  }

  /** PCAP-derived events only ever carry an IP, not a hostname — same fallback contract as resolveDeviceId. */
  private async resolveDeviceIdByIp(ipAddress: string): Promise<string | undefined> {
    const device = await this.devicesService.findByIpAddress(ipAddress);
    if (!device) {
      this.logger.warn(
        `No registered device for IP "${ipAddress}" — ingesting without device context`,
      );
      return undefined;
    }
    return device.id;
  }
}
