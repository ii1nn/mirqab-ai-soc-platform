import { enrichFromExcerpt } from '../enrichment/incident-enrichment.util';
import { deriveIndicators } from './indicator.util';

describe('deriveIndicators', () => {
  it('converts enrichment IOCs (IP/hash/domain) into typed Indicator candidates', () => {
    const text =
      'Connection from 203.0.113.5 downloaded payload with hash a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 from evil-domain.xyz';
    const enrichment = enrichFromExcerpt(text);
    const indicators = deriveIndicators(text, enrichment);

    expect(
      indicators.some((i) => i.category === 'IOC' && i.type === 'IP' && i.value === '203.0.113.5'),
    ).toBe(true);
    expect(indicators.some((i) => i.category === 'IOC' && i.type === 'HASH')).toBe(true);
    expect(indicators.some((i) => i.category === 'IOC' && i.type === 'DOMAIN')).toBe(true);
  });

  it('extracts URLs and emails as IOCs', () => {
    const text =
      'Phishing email from attacker@evil.example linked to http://malicious.example/payload.exe';
    const enrichment = enrichFromExcerpt(text);
    const indicators = deriveIndicators(text, enrichment);

    expect(indicators.some((i) => i.type === 'URL')).toBe(true);
    expect(indicators.some((i) => i.type === 'EMAIL' && i.value === 'attacker@evil.example')).toBe(
      true,
    );
  });

  it('detects credential-dumping IOA behavior (mimikatz)', () => {
    const text = 'Analyst observed mimikatz sekurlsa::logonpasswords executed against lsass.dmp';
    const enrichment = enrichFromExcerpt(text);
    const indicators = deriveIndicators(text, enrichment);

    const ioa = indicators.find((i) => i.category === 'IOA' && i.subtype === 'credential-dumping');
    expect(ioa).toBeDefined();
    expect(ioa?.mitreTechniqueId).toBe('T1003');
  });

  it('detects obfuscated PowerShell execution as an IOA', () => {
    const text = 'powershell.exe -EncodedCommand SQBFAFgA executed on the host';
    const enrichment = enrichFromExcerpt(text);
    const indicators = deriveIndicators(text, enrichment);

    expect(indicators.some((i) => i.subtype === 'obfuscated-execution')).toBe(true);
  });

  it('returns no IOAs when the text has no behavioral signal', () => {
    const text = 'Routine backup completed successfully overnight.';
    const enrichment = enrichFromExcerpt(text);
    const indicators = deriveIndicators(text, enrichment);

    expect(indicators.filter((i) => i.category === 'IOA')).toEqual([]);
  });
});
