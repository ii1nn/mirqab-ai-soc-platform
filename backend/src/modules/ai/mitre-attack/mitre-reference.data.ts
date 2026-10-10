export interface MitreReferenceEntry {
  id: string;
  name: string;
  tactic: string;
  /** Lowercase phrases used by MitreMappingService's keyword matcher. */
  keywords: string[];
}

/** Real MITRE ATT&CK technique references — not invented IDs. */
export const MITRE_REFERENCE: MitreReferenceEntry[] = [
  {
    id: 'T1566',
    name: 'Phishing',
    tactic: 'Initial Access',
    keywords: [
      'phishing',
      'suspicious link',
      'email attachment',
      'spoofed sender',
      'credential harvesting page',
    ],
  },
  {
    id: 'T1110',
    name: 'Brute Force',
    tactic: 'Credential Access',
    keywords: [
      'brute force',
      'failed login',
      'failed authentication',
      'password guessing',
      'repeated login attempt',
    ],
  },
  {
    id: 'T1204',
    name: 'User Execution',
    tactic: 'Execution',
    keywords: [
      'user opened',
      'macro enabled',
      'malicious attachment executed',
      'payload executed',
      'user execution',
    ],
  },
  {
    id: 'T1046',
    name: 'Network Service Discovery',
    tactic: 'Discovery',
    keywords: ['port scan', 'service enumeration', 'nmap', 'network scan', 'port sweep'],
  },
  {
    id: 'T1068',
    name: 'Exploitation for Privilege Escalation',
    tactic: 'Privilege Escalation',
    keywords: [
      'privilege escalation',
      'exploit',
      'unauthorized admin',
      'uac bypass',
      'elevation of privilege',
    ],
  },
  {
    id: 'T1486',
    name: 'Data Encrypted for Impact',
    tactic: 'Impact',
    keywords: [
      'ransomware',
      'files encrypted',
      'ransom note',
      'encryption of files',
      'extension changed to .locked',
    ],
  },
  {
    id: 'T1071',
    name: 'Application Layer Protocol',
    tactic: 'Command and Control',
    keywords: [
      'command and control',
      'c2 beacon',
      'beaconing',
      'outbound https to unknown',
      'callback traffic',
    ],
  },
  {
    id: 'T1053',
    name: 'Scheduled Task/Job',
    tactic: 'Persistence',
    keywords: [
      'scheduled task created',
      'cron job',
      'at job',
      'persistence mechanism',
      'new scheduled task',
    ],
  },
  {
    id: 'T1078',
    name: 'Valid Accounts',
    tactic: 'Persistence',
    keywords: [
      'valid account misuse',
      'compromised credentials',
      'account takeover',
      'login from unusual location',
      'impossible travel',
    ],
  },
  {
    id: 'T1059',
    name: 'Command and Scripting Interpreter',
    tactic: 'Execution',
    keywords: ['powershell', 'cmd.exe', 'script execution', 'encoded command', 'obfuscated script'],
  },
  {
    id: 'T1105',
    name: 'Ingress Tool Transfer',
    tactic: 'Command and Control',
    keywords: [
      'file download',
      'tool transfer',
      'remote file copy',
      'downloaded executable',
      'certutil download',
    ],
  },
  {
    id: 'T1567',
    name: 'Exfiltration Over Web Service',
    tactic: 'Exfiltration',
    keywords: [
      'data exfiltration',
      'upload to cloud storage',
      'large outbound transfer',
      'exfil',
      'unusual data upload',
    ],
  },
];
