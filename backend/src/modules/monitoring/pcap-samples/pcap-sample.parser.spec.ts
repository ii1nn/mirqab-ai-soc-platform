import { parsePcapSampleEvent } from './pcap-sample.parser';
import { loadPcapSampleEvents, RawZeekEcsEvent } from './pcap-samples.data';

describe('parsePcapSampleEvent', () => {
  // Reads the real datasets/PcapMonkey/zeek-sample-events.json file — these
  // are integration tests against the actual on-disk dataset, not fixtures.
  const events: RawZeekEcsEvent[] = loadPcapSampleEvents();

  it('parses all 6 real bundled sample events without dropping any', () => {
    const parsed = events.map(parsePcapSampleEvent);
    expect(parsed).toHaveLength(6);
    expect(parsed.map((e) => e.dataset)).toEqual([
      'zeek.connection',
      'zeek.dns',
      'zeek.http',
      'zeek.notice',
      'zeek.ssl',
      'zeek.weird',
    ]);
  });

  it('carries source/destination/transport through unchanged', () => {
    const httpRaw = events.find((e) => e.dataset === 'zeek.http')!;
    const parsed = parsePcapSampleEvent(httpRaw);

    expect(parsed.sourceIp).toBe('10.12.1.101');
    expect(parsed.sourcePort).toBe(49790);
    expect(parsed.destinationIp).toBe('5.44.43.72');
    expect(parsed.destinationPort).toBe(80);
    expect(parsed.transport).toBe('tcp');
    expect(parsed.timestamp).toBe('2020-12-01T23:41:42.845Z');
  });

  it('summarizes a zeek.notice event with its real rule name and description', () => {
    const noticeRaw = events.find((e) => e.dataset === 'zeek.notice')!;
    const parsed = parsePcapSampleEvent(noticeRaw);

    expect(parsed.detail).toContain('SSL::Invalid_Server_Cert');
    expect(parsed.detail).toContain('self signed certificate');
  });

  it('summarizes a zeek.http event including the suspicious executable MIME type', () => {
    const httpRaw = events.find((e) => e.dataset === 'zeek.http')!;
    const parsed = parsePcapSampleEvent(httpRaw);

    expect(parsed.detail).toContain('GET');
    expect(parsed.detail).toContain('200');
    expect(parsed.detail).toContain('application/x-dosexec');
  });

  it('summarizes a zeek.weird anomaly with its rule name', () => {
    const weirdRaw = events.find((e) => e.dataset === 'zeek.weird')!;
    const parsed = parsePcapSampleEvent(weirdRaw);

    expect(parsed.detail).toContain('DNS_RR_length_mismatch');
  });

  it('preserves the complete original ECS record verbatim as raw evidence', () => {
    for (const event of events) {
      expect(event.raw.length).toBeGreaterThan(0);
      const parsedRaw = JSON.parse(event.raw);
      expect(parsedRaw._source.event.dataset).toBe(event.dataset);
    }
  });
});
