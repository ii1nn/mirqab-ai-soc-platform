import { IndicatorCandidate } from './indicator.util';

/**
 * Command-and-control indicator detection — deterministic keyword matching
 * over real evidence text, same philosophy as persistence.util.ts. Produces
 * IOA-category Indicator rows tagged with a 'c2-*' subtype so the Weekly SOC
 * Report and case investigation views can query C2 findings distinctly from
 * generic behavioral IOAs, without a separate table. Reuses the real MITRE
 * Command and Control technique IDs already in mitre-reference.data.ts
 * (T1071, T1105) where applicable.
 */

interface C2Rule {
  pattern: RegExp;
  subtype: 'c2-framework' | 'c2-beaconing' | 'c2-dns-tunneling';
  description: string;
  mitreTechniqueId: string;
  confidence: number;
}

const RULES: C2Rule[] = [
  {
    pattern:
      /\b(cobalt strike|beacon\.dll|meterpreter|metasploit|empire agent|powershell empire|sliver c2|havoc c2|mythic c2|bruteratel)\b/i,
    subtype: 'c2-framework',
    description: 'Known C2 framework or implant referenced',
    mitreTechniqueId: 'T1071',
    confidence: 88,
  },
  {
    pattern:
      /\b(periodic beacon|check-in interval|callback (every|interval)|heartbeat to c2|beaconing pattern|jitter\s*\d+%)\b/i,
    subtype: 'c2-beaconing',
    description: 'Beaconing / periodic callback pattern referenced',
    mitreTechniqueId: 'T1071',
    confidence: 70,
  },
  {
    pattern:
      /\b(dns tunneling|txt record exfiltration|unusual dns query volume|dns beacon|iodine tunnel|dnscat)\b/i,
    subtype: 'c2-dns-tunneling',
    description: 'DNS tunneling indicator referenced',
    mitreTechniqueId: 'T1071.004',
    confidence: 75,
  },
];

export function detectC2(text: string): IndicatorCandidate[] {
  const findings: IndicatorCandidate[] = [];
  for (const rule of RULES) {
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
