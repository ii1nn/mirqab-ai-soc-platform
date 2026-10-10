/**
 * Deterministic, regex/keyword extraction from a real `sourceExcerpt` —
 * no external geo-IP/threat-intel service, no invented values. Every field
 * is null when the text doesn't actually contain that signal. This is the
 * data source for the Similar Attack Analysis comparison engine
 * (see ../comparison/incident-comparison.util.ts) — it only ever compares
 * what was genuinely extracted.
 */
export interface IncidentEnrichment {
  malwareFamily: string | null;
  sourceIp: string | null;
  sourceCountry: string | null;
  destinationAsset: string | null;
  iocs: string[];
  detectionRule: string | null;
  userAccount: string | null;
}

/** Real, known malware/threat-actor tooling family names — not invented. */
const KNOWN_MALWARE_FAMILIES = [
  'Emotet',
  'TrickBot',
  'Ryuk',
  'LockBit',
  'Conti',
  'Qakbot',
  'Cobalt Strike',
  'Mimikatz',
  'AgentTesla',
  'njRAT',
  'BlackCat',
  'Akira',
  'Clop',
  'BlackBasta',
  'IcedID',
];

const KNOWN_COUNTRIES = [
  'Russia',
  'China',
  'North Korea',
  'Iran',
  'Ukraine',
  'Romania',
  'Nigeria',
  'Brazil',
  'Vietnam',
  'United States',
  'Germany',
  'Netherlands',
];

const HOSTNAME_PATTERN = /\b[A-Z]{2,}(?:-[A-Z]{2,}){1,2}-\d{2,}\b/g;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MD5_PATTERN = /\b[a-f0-9]{32}\b/gi;
const SHA1_PATTERN = /\b[a-f0-9]{40}\b/gi;
const SHA256_PATTERN = /\b[a-f0-9]{64}\b/gi;
const DOMAIN_PATTERN = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|ru|cn|io|xyz|top|info|biz)\b/gi;
const DETECTION_RULE_PATTERN =
  /\b(?:Sigma rule|Suricata SID|Wazuh rule(?: ID)?|YARA rule)[:\s#]*([A-Za-z0-9_-]+)?/i;
// Requires an explicit "user:"/"account:" field separator — a bare
// `[:\s]+` here previously matched natural-language phrases like "a user
// on HOSTNAME" (capturing "on" as the account), a real bug caught by
// smoke-testing the actual /ai/analyze response, not just reviewing the regex.
const USER_PATTERN = /\b(?:user|account)\s*[:=]\s*([A-Za-z0-9_.-]{2,32})/i;

function isPrivateOrLoopbackIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return Array.from(new Set(text.match(pattern) ?? []));
}

export function enrichFromExcerpt(text: string, reportingHostname?: string): IncidentEnrichment {
  const malwareFamily =
    KNOWN_MALWARE_FAMILIES.find((name) => text.toLowerCase().includes(name.toLowerCase())) ?? null;
  const sourceCountry = KNOWN_COUNTRIES.find((country) => text.includes(country)) ?? null;

  const ipMatches = uniqueMatches(text, IPV4_PATTERN);
  const publicIps = ipMatches.filter((ip) => !isPrivateOrLoopbackIp(ip));
  const sourceIp = publicIps[0] ?? ipMatches[0] ?? null;

  const hashMatches = [
    ...uniqueMatches(text, SHA256_PATTERN),
    ...uniqueMatches(text, SHA1_PATTERN),
    ...uniqueMatches(text, MD5_PATTERN),
  ];
  const domainMatches = uniqueMatches(text, DOMAIN_PATTERN);

  const iocs = [
    ...ipMatches.map((ip) => `ip:${ip}`),
    ...hashMatches.map((hash) => `hash:${hash.toLowerCase()}`),
    ...domainMatches.map((domain) => `domain:${domain.toLowerCase()}`),
  ];

  const destinationAsset =
    uniqueMatches(text, HOSTNAME_PATTERN).find((host) => host !== reportingHostname) ?? null;

  const detectionRuleMatch = text.match(DETECTION_RULE_PATTERN);
  const detectionRule = detectionRuleMatch ? detectionRuleMatch[0].trim() : null;

  const userMatch = text.match(USER_PATTERN);
  const userAccount = userMatch ? userMatch[1].replace(/[.,;]+$/, '') : null;

  return {
    malwareFamily,
    sourceIp,
    sourceCountry,
    destinationAsset,
    iocs,
    detectionRule,
    userAccount,
  };
}
