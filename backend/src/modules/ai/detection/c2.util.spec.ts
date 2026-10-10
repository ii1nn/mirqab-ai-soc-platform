import { detectC2 } from './c2.util';

describe('detectC2', () => {
  it('detects a known C2 framework mention (Cobalt Strike)', () => {
    const findings = detectC2(
      'Endpoint telemetry shows a Cobalt Strike beacon.dll loaded in memory.',
    );
    const finding = findings.find((f) => f.subtype === 'c2-framework');
    expect(finding).toBeDefined();
    expect(finding?.mitreTechniqueId).toBe('T1071');
  });

  it('detects beaconing language', () => {
    const findings = detectC2(
      'Outbound traffic shows a periodic beacon with a 60s check-in interval to an external host.',
    );
    expect(findings.some((f) => f.subtype === 'c2-beaconing')).toBe(true);
  });

  it('detects DNS tunneling indicators', () => {
    const findings = detectC2(
      'Unusual DNS query volume observed consistent with DNS tunneling via TXT record exfiltration.',
    );
    expect(findings.some((f) => f.subtype === 'c2-dns-tunneling')).toBe(true);
  });

  it('returns an empty array when there is no C2 evidence', () => {
    expect(detectC2('The weekly report was generated successfully today.')).toEqual([]);
  });
});
