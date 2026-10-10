import type { VirtualDevice } from '../types/domain';

export type ScenarioType =
  'phishing' | 'brute-force' | 'malware' | 'port-scan' | 'privilege-escalation';

export const SCENARIOS: ScenarioType[] = [
  'phishing',
  'brute-force',
  'malware',
  'port-scan',
  'privilege-escalation',
];

/**
 * Phrased to match backend/src/modules/ai/mitre-attack/mitre-reference.data.ts
 * keyword lists exactly, so the AI engine's rule-based fallback (used when no
 * ANTHROPIC_API_KEY is configured) reliably reclassifies each simulated event
 * back to its intended MITRE technique — the pipeline works end-to-end even
 * without a Claude API key.
 *
 * Each excerpt also carries real, extractable IOC/malware/user/detection-rule
 * text (see backend/src/modules/ai/enrichment) — still synthetic telemetry
 * like the rest of Simulation Mode, but the extraction that turns it into
 * `Incident.iocs`/`malwareFamily`/etc. is the same regex/keyword pipeline
 * real Wazuh/Suricata/Sysmon payloads go through, not a shortcut.
 */
const LOG_EXCERPT_BUILDERS: Record<ScenarioType, (device: VirtualDevice) => string> = {
  phishing: (device) =>
    `A user on ${device.hostname} received a phishing email containing a suspicious link mimicking a trusted sender. ` +
    `The link resolved to 203.0.113.44, registered in Romania. user: ${sampleUser(device)}. ` +
    `Flagged by Sigma rule phishing_link_click.`,
  'brute-force': (device) =>
    `${device.hostname} logged repeated failed authentication attempts consistent with password guessing (brute force). ` +
    `Source 198.51.100.23, traced to an IP registered in Russia. account: ${sampleUser(device)}. ` +
    `Wazuh rule ID 5710.`,
  malware: (device) =>
    `Endpoint telemetry on ${device.hostname} shows files encrypted and a ransom note dropped — ransomware suspected. ` +
    `LockBit indicators identified, payload hash ${sampleHash(device)}. Lateral connection observed toward ${destinationFor(device)}. ` +
    `YARA rule lockbit_payload_match.`,
  'port-scan': (device) =>
    `${device.hostname} triggered a network scan alert from sequential port scan activity (nmap-style) against the subnet. ` +
    `Originating from 192.0.2.77, scanning toward ${destinationFor(device)}. Suricata SID 2027101.`,
  'privilege-escalation': (device) =>
    `A process on ${device.hostname} attempted privilege escalation via a UAC bypass to gain unauthorized admin rights. ` +
    `account: ${sampleUser(device)}. Mimikatz indicators observed in process memory. Sigma rule proc_creation_win_uac_bypass.`,
};

const SAMPLE_USERS = ['jsmith', 'a.hassan', 'mrodriguez', 'k.tanaka', 'p.okafor'];
const DESTINATION_ASSETS = ['FILE-SRV-02', 'DB-CORE-01', 'APP-GATEWAY-03'];

function sampleUser(device: VirtualDevice): string {
  const index = hashIndex(device.hostname, SAMPLE_USERS.length);
  return SAMPLE_USERS[index];
}

function destinationFor(device: VirtualDevice): string {
  const index = hashIndex(device.hostname, DESTINATION_ASSETS.length);
  return DESTINATION_ASSETS[index];
}

function sampleHash(device: VirtualDevice): string {
  const seed = hashIndex(device.hostname, 0xffffff);
  return seed.toString(16).padStart(6, '0').repeat(11).slice(0, 64);
}

function hashIndex(input: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return mod === 0 ? hash : hash % mod;
}

export function buildLogExcerpt(scenario: ScenarioType, device: VirtualDevice): string {
  return LOG_EXCERPT_BUILDERS[scenario](device);
}

export function randomScenario(): ScenarioType {
  return SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
}
