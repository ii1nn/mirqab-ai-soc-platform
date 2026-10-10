import { IncidentEnrichment } from '../enrichment/incident-enrichment.util';

/**
 * Structured IOC (static artifact) and IOA (behavioral pattern) extraction.
 * IOCs reuse the same tagged strings incident-enrichment.util.ts already
 * derives from real text (ip:/hash:/domain:) rather than re-deriving them
 * with a second set of regexes — this only adds URL/email extraction and
 * classifies confidence per type. IOAs are new: deterministic keyword
 * detection for behaviors (credential dumping, lateral movement, process
 * injection, obfuscated execution) that aren't captured by a single static
 * artifact. Never fabricated — no match means no row.
 */

export type IndicatorType =
  | 'IP'
  | 'DOMAIN'
  | 'URL'
  | 'HASH'
  | 'EMAIL'
  | 'FILE_PATH'
  | 'REGISTRY_KEY'
  | 'MUTEX'
  | 'USER_ACCOUNT'
  | 'BEHAVIOR';

export interface IndicatorCandidate {
  category: 'IOC' | 'IOA';
  type: IndicatorType;
  value: string;
  description: string | null;
  subtype: string | null;
  mitreTechniqueId: string | null;
  confidence: number;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return Array.from(new Set(text.match(pattern) ?? []));
}

function iocsFromEnrichment(enrichment: IncidentEnrichment): IndicatorCandidate[] {
  return enrichment.iocs.map((tagged) => {
    const [tag, ...rest] = tagged.split(':');
    const value = rest.join(':');
    if (tag === 'ip') {
      return {
        category: 'IOC',
        type: 'IP',
        value,
        description: null,
        subtype: null,
        mitreTechniqueId: null,
        confidence: 75,
      } as const;
    }
    if (tag === 'hash') {
      return {
        category: 'IOC',
        type: 'HASH',
        value,
        description: null,
        subtype: null,
        mitreTechniqueId: null,
        confidence: 85,
      } as const;
    }
    return {
      category: 'IOC',
      type: 'DOMAIN',
      value,
      description: null,
      subtype: null,
      mitreTechniqueId: null,
      confidence: 75,
    } as const;
  });
}

interface IoaRule {
  pattern: RegExp;
  subtype: string;
  description: string;
  mitreTechniqueId: string;
  confidence: number;
}

const IOA_RULES: IoaRule[] = [
  {
    pattern: /\b(mimikatz|lsass\.dmp|procdump.*lsass|sekurlsa)\b/i,
    subtype: 'credential-dumping',
    description: 'Credential dumping tooling referenced',
    mitreTechniqueId: 'T1003',
    confidence: 85,
  },
  {
    pattern: /\b(psexec|wmic\s+\/node|invoke-command\s+-computername|pass-the-hash|pth-winexe)\b/i,
    subtype: 'lateral-movement',
    description: 'Lateral movement tooling referenced',
    mitreTechniqueId: 'T1021',
    confidence: 75,
  },
  {
    pattern: /\b(reflective dll injection|process hollowing|dll injection|createremotethread)\b/i,
    subtype: 'process-injection',
    description: 'Process injection technique referenced',
    mitreTechniqueId: 'T1055',
    confidence: 80,
  },
  {
    // No leading `\b` before the `-` flags: `-` isn't a word character, so a
    // boundary assertion immediately before it can never match when preceded
    // by whitespace (caught by indicator.util.spec.ts, not just review).
    pattern:
      /(-enc\b|-encodedcommand\b|frombase64string|iex\s*\(|invoke-expression|-noni?p?(?:\s|$)|-windowstyle\s+hidden)/i,
    subtype: 'obfuscated-execution',
    description: 'Obfuscated or encoded command execution',
    mitreTechniqueId: 'T1059',
    confidence: 70,
  },
  {
    pattern:
      /\b(disabled windows defender|disable-windowsdefender|amsi bypass|stopped antivirus|excluded from scanning)\b/i,
    subtype: 'defense-evasion',
    description: 'Security tooling tampered with or bypassed',
    mitreTechniqueId: 'T1562',
    confidence: 80,
  },
];

function ioasFromText(text: string): IndicatorCandidate[] {
  const findings: IndicatorCandidate[] = [];
  for (const rule of IOA_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    findings.push({
      category: 'IOA',
      type: 'BEHAVIOR',
      value: match[0],
      description: rule.description,
      subtype: rule.subtype,
      mitreTechniqueId: rule.mitreTechniqueId,
      confidence: rule.confidence,
    });
  }
  return findings;
}

export function deriveIndicators(
  text: string,
  enrichment: IncidentEnrichment,
): IndicatorCandidate[] {
  const urls = uniqueMatches(text, URL_PATTERN).map((value): IndicatorCandidate => ({
    category: 'IOC',
    type: 'URL',
    value,
    description: null,
    subtype: null,
    mitreTechniqueId: null,
    confidence: 70,
  }));

  const emails = uniqueMatches(text, EMAIL_PATTERN).map((value): IndicatorCandidate => ({
    category: 'IOC',
    type: 'EMAIL',
    value,
    description: null,
    subtype: null,
    mitreTechniqueId: null,
    confidence: 60,
  }));

  return [...iocsFromEnrichment(enrichment), ...urls, ...emails, ...ioasFromText(text)];
}
