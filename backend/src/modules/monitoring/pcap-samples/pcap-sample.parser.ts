import { PcapEventDto } from '../dto/pcap-event.dto';
import { RawZeekEcsEvent } from './pcap-samples.data';

/**
 * Turns one raw Zeek/ECS sample event (see pcap-samples.data.ts) into the
 * `PcapEventDto` shape a real PcapMonkey deployment's pipeline output would
 * be adapted into before reaching `/monitoring/pcap`. `detail` is an
 * accurate, protocol-specific one-line summary — same decoded/raw split
 * every other sample parser in this codebase uses.
 */
export function parsePcapSampleEvent(raw: RawZeekEcsEvent): PcapEventDto {
  return {
    dataset: raw.dataset,
    sourceIp: raw.sourceIp,
    sourcePort: raw.sourcePort,
    destinationIp: raw.destinationIp,
    destinationPort: raw.destinationPort,
    transport: raw.transport,
    detail: summarize(raw),
    timestamp: raw.timestamp,
  };
}

function summarize(raw: RawZeekEcsEvent): string {
  const f = raw.fields;

  switch (raw.dataset) {
    case 'zeek.connection':
      return String(f.stateMessage ?? 'Connection observed');
    case 'zeek.dns':
      return `DNS query for "${f.query}" (type ${f.qtypeName}) -> ${f.responseCode}`;
    case 'zeek.http':
      return `HTTP ${f.method} ${f.url} -> ${f.statusCode} (response type: ${f.respMimeType}, user agent: ${f.userAgent})`;
    case 'zeek.notice':
      return `Zeek security notice "${f.ruleName}": ${f.description}`;
    case 'zeek.ssl':
      return `TLS ${f.tlsVersion} handshake to ${f.serverSubject} (issuer: ${f.serverIssuer}, cipher ${f.cipher}), certificate validation: ${f.validationStatus}`;
    case 'zeek.weird':
      return `Zeek protocol anomaly "${f.ruleName}" (source: ${f.weirdSource})`;
    default:
      return 'Zeek network event';
  }
}
