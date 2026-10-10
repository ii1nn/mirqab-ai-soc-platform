import { MitreMappingService } from './mitre-mapping.service';

describe('MitreMappingService', () => {
  let service: MitreMappingService;

  beforeEach(() => {
    service = new MitreMappingService();
  });

  it('matches a brute-force log excerpt to T1110', () => {
    const match = service.match(
      'User admin logged 15 failed authentication attempts in two minutes.',
    );
    expect(match?.technique.id).toBe('T1110');
    expect(match?.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('matches a ransomware log excerpt to T1486', () => {
    const match = service.match(
      'Multiple files encrypted and a ransom note dropped on the desktop.',
    );
    expect(match?.technique.id).toBe('T1486');
  });

  it('returns null when no keywords match', () => {
    const match = service.match('The weekly report was generated successfully.');
    expect(match).toBeNull();
  });

  it('prefers the technique with the most matched keywords', () => {
    const match = service.match(
      'Port scan detected: network scan and service enumeration across the subnet using nmap.',
    );
    expect(match?.technique.id).toBe('T1046');
    expect(match?.matchedKeywords.length).toBeGreaterThanOrEqual(3);
  });

  it('validates known vs unknown technique IDs', () => {
    expect(service.isKnownTechnique('T1566')).toBe(true);
    expect(service.isKnownTechnique('T9999')).toBe(false);
  });

  it('looks up a technique by ID', () => {
    expect(service.getById('T1068')?.name).toBe('Exploitation for Privilege Escalation');
    expect(service.getById('T9999')).toBeUndefined();
  });
});
