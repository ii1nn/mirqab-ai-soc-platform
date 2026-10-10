import { readFileSync } from 'fs';
import { datasetPath } from '../dataset-path.util';

export interface RawZeekEcsEvent {
  timestamp: string;
  dataset: string;
  sourceIp: string;
  sourcePort?: number;
  destinationIp?: string;
  destinationPort?: number;
  transport?: string;
  /** Only the protocol-specific fields this module actually reads — not a full ECS mirror. */
  fields: Record<string, string | number | boolean>;
  /** The complete, untouched ECS record exactly as read from disk — the real raw evidence. */
  raw: string;
}

interface EcsSource {
  '@timestamp': string;
  event?: { dataset?: string };
  source?: { ip?: string; port?: number };
  destination?: { ip?: string; port?: number };
  network?: { transport?: string };
  zeek?: Record<string, any>;
  rule?: { name?: string; description?: string };
  http?: { request?: { method?: string }; response?: { status_code?: number } };
  url?: { original?: string };
  user_agent?: { original?: string };
}

function extractFields(dataset: string, source: EcsSource): Record<string, string | number | boolean> {
  const zeek = source.zeek ?? {};
  switch (dataset) {
    case 'zeek.connection':
      return { stateMessage: zeek.connection?.state_message ?? 'Connection observed' };
    case 'zeek.dns':
      return {
        query: zeek.dns?.query ?? '',
        qtypeName: zeek.dns?.qtype_name ?? '',
        responseCode: zeek.dns?.rcode_name ?? '',
      };
    case 'zeek.http':
      return {
        method: source.http?.request?.method ?? '',
        url: source.url?.original ?? '',
        statusCode: source.http?.response?.status_code ?? '',
        respMimeType: zeek.http?.resp_mime_types?.[0] ?? '',
        userAgent: source.user_agent?.original ?? '',
      };
    case 'zeek.notice':
      return { ruleName: source.rule?.name ?? '', description: source.rule?.description ?? '' };
    case 'zeek.ssl': {
      const server = zeek.ssl?.server;
      const issuer = server?.issuer;
      return {
        tlsVersion: zeek.ssl?.version ?? '',
        cipher: zeek.ssl?.cipher ?? '',
        serverSubject: server?.subject?.common_name ?? '',
        serverIssuer: issuer
          ? `CN=${issuer.common_name},O=${issuer.organization},C=${issuer.country}`
          : '',
        validationStatus: zeek.ssl?.validation?.status ?? '',
      };
    }
    case 'zeek.weird':
      return { ruleName: zeek.weird?.name ?? '', weirdSource: zeek.weird?.source ?? '' };
    default:
      return {};
  }
}

/**
 * Reads the real datasets/PcapMonkey/zeek-sample-events.json file at call
 * time — PcapMonkey's own Zeek-via-Elasticsearch (ECS) test fixture, in
 * full, not a hand-transcribed subset. Each record's complete original ECS
 * JSON is preserved verbatim in `raw` for evidentiary citation.
 */
export function loadPcapSampleEvents(): RawZeekEcsEvent[] {
  let raw = readFileSync(datasetPath('PcapMonkey', 'zeek-sample-events.json'), 'utf-8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const records: Array<{ _source: EcsSource }> = JSON.parse(raw);
  return records.map((record) => {
    const source = record._source;
    const dataset = source.event?.dataset ?? 'unknown';
    return {
      timestamp: source['@timestamp'],
      dataset,
      sourceIp: source.source?.ip ?? '',
      sourcePort: source.source?.port,
      destinationIp: source.destination?.ip,
      destinationPort: source.destination?.port,
      transport: source.network?.transport,
      fields: extractFields(dataset, source),
      raw: JSON.stringify(record),
    };
  });
}
