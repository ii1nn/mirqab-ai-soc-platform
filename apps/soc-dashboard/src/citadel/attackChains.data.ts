/**
 * Attack-chain reference data for Citadel's Attack Path view (Integration
 * Phase 6). Static, client-side data — same convention as
 * `simulation/scenarios.ts` (Simulation Mode's bundled scenario data) —
 * since this is fixed reference/demo content, not something that needs a
 * database table or a live API round-trip.
 *
 * `apt29` is ported verbatim from `datasets/Security-Datasets/apt29-attack-chain.json`
 * (itself hand-condensed from the real MITRE ATT&CK Evaluations APT29
 * emulation-plan spreadsheet — see that file's NOTES.md for provenance).
 * `frothly` is ported verbatim from `datasets/botsv3/frothly-attack-chain.json`
 * (a hand-authored mock modeled on the public BOTS v3 CTF storyline, since
 * splunk/botsv3's real dataset was never downloaded — see that NOTES.md).
 */

export interface AttackChainStep {
  step: string;
  stage: string;
  techniques: string[];
  source: string;
  target: string;
  description: string;
}

export interface AttackChain {
  id: string;
  name: string;
  actor: string;
  provenance: 'real' | 'mock';
  sourceLabel: string;
  steps: AttackChainStep[];
}

export const ATTACK_CHAINS: AttackChain[] = [
  {
    id: 'apt29',
    name: 'APT29 — MITRE ATT&CK Evaluations',
    actor: 'APT29 (emulated, MITRE ATT&CK Evaluations Round 2)',
    provenance: 'real',
    sourceLabel: 'OTRF/Security-Datasets — real emulation plan',
    steps: [
      {
        step: '1.A',
        stage: 'Initial Breach',
        techniques: ['T1204 User Execution', 'T1036 Masquerading', 'T1065 Uncommonly Used Port'],
        source: 'attacker',
        target: 'SCRANTON',
        description:
          'User clicks an executable masquerading as a document; payload opens a C2 connection over port 1234.',
      },
      {
        step: '1.B',
        stage: 'Initial Breach',
        techniques: ['T1059 Command-Line Interface', 'T1086 PowerShell'],
        source: 'attacker',
        target: 'SCRANTON',
        description:
          'Attacker spawns interactive cmd.exe and powershell.exe via the C2 connection.',
      },
      {
        step: '2.A',
        stage: 'Rapid Collection and Exfiltration',
        techniques: [
          'T1083 File and Directory Discovery',
          'T1119 Automated Collection',
          'T1005 Data from Local System',
          'T1002 Data Compressed',
          'T1074 Data Staged',
        ],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description:
          'Searches the filesystem for documents/media, collects and compresses them into a single archive.',
      },
      {
        step: '2.B',
        stage: 'Rapid Collection and Exfiltration',
        techniques: ['T1041 Exfiltration Over C2 Channel'],
        source: 'SCRANTON',
        target: 'attacker',
        description: 'Staged archive exfiltrated over the existing C2 connection.',
      },
      {
        step: '3.A',
        stage: 'Deploy Stealth Toolkit',
        techniques: ['T1105 Remote File Copy', 'T1027 Obfuscated Files or Information'],
        source: 'attacker',
        target: 'SCRANTON',
        description: 'Uploads an image file with a concealed PowerShell script.',
      },
      {
        step: '3.B',
        stage: 'Deploy Stealth Toolkit',
        techniques: [
          'T1122 COM Hijacking',
          'T1088 Bypass UAC',
          'T1043 Commonly Used Port',
          'T1071 Standard App Layer Protocol',
        ],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description:
          'UAC bypass executes the hidden payload; new HTTPS C2 connection established on port 443.',
      },
      {
        step: '4.B',
        stage: 'Defense Evasion and Discovery',
        techniques: ['T1057 Process Discovery', 'T1107 File Deletion'],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description:
          'Enumerates running processes to find/kill the original access, then deletes associated files.',
      },
      {
        step: '4.C',
        stage: 'Defense Evasion and Discovery',
        techniques: [
          'T1083 File and Directory Discovery',
          'T1033 System Owner/User Discovery',
          'T1082 System Information Discovery',
          'T1016 System Network Config Discovery',
          'T1057 Process Discovery',
          'T1063 Security Software Discovery',
          'T1069 Permission Groups Discovery',
        ],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description:
          'Wide recon sweep via a single discovery script, partly via Windows API calls.',
      },
      {
        step: '5.A',
        stage: 'Persistence',
        techniques: ['T1050 New Service'],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description: 'Creates a new Windows service for persistent access.',
      },
      {
        step: '5.B',
        stage: 'Persistence',
        techniques: ['T1060 Registry Run Keys / Startup Folder'],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description: 'Drops a payload into the Startup folder as a second persistence mechanism.',
      },
      {
        step: '6.A',
        stage: 'Credentials Access',
        techniques: [
          'T1081 Credentials in Files',
          'T1003 Credential Dumping',
          'T1036 Masquerading',
        ],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description: 'Harvests browser-stored credentials using a renamed/masquerading tool.',
      },
      {
        step: '6.C',
        stage: 'Credentials Access',
        techniques: ['T1003 Credential Dumping'],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description: 'Dumps password hashes from the host.',
      },
      {
        step: '8.A',
        stage: 'Lateral Movement',
        techniques: [
          'T1018 Remote System Discovery',
          'T1028 Windows Remote Management',
          'T1057 Process Discovery',
        ],
        source: 'SCRANTON',
        target: 'NASHUA',
        description:
          'LDAP-enumerates domain hosts, opens a remote PowerShell session to a second victim.',
      },
      {
        step: '8.C',
        stage: 'Lateral Movement',
        techniques: [
          'T1077 Windows Admin Shares',
          'T1035 Service Execution',
          'T1078 Valid Accounts',
        ],
        source: 'SCRANTON',
        target: 'NASHUA',
        description:
          'New payload executed on the second victim via PsExec using stolen credentials.',
      },
      {
        step: '9.B',
        stage: 'Collection',
        techniques: [
          'T1083 File and Directory Discovery',
          'T1119 Automated Collection',
          'T1005 Data from Local System',
          'T1022 Data Encrypted',
          'T1002 Data Compressed',
          'T1074 Data Staged',
          'T1041 Exfiltration Over C2 Channel',
        ],
        source: 'NASHUA',
        target: 'attacker',
        description:
          "Second victim's files collected, encrypted, compressed, and exfiltrated over C2.",
      },
      {
        step: '10.A',
        stage: 'Persistence & Execution',
        techniques: ['T1035 Service Execution', 'T1060 Registry Run Keys / Startup Folder'],
        source: 'SCRANTON',
        target: 'SCRANTON',
        description:
          'Original victim reboots; both persistence mechanisms fire, giving a fresh callback.',
      },
      {
        step: '11.A',
        stage: 'Windows Initial Access Payload',
        techniques: [
          'T1204 User Execution',
          'T1096 NTFS ADS',
          'T1497 Virtualization/Sandbox Evasion',
          'T1060 Registry Run Keys / Startup Folder',
          'T1140 Deobfuscate/Decode Files',
          'T1086 PowerShell',
          'T1043 Commonly Used Port',
          'T1071 Standard App Layer Protocol',
        ],
        source: 'attacker',
        target: 'UTICA',
        description:
          'Second-day scenario: user clicks a link file; hidden ADS payload sandbox-checks, persists via Run key, and opens an HTTPS C2 channel.',
      },
      {
        step: '14.A',
        stage: 'Elevation',
        techniques: ['T1122 COM Hijacking', 'T1088 Bypass UAC'],
        source: 'UTICA',
        target: 'UTICA',
        description: 'UAC bypass yields a high-integrity callback.',
      },
      {
        step: '14.B',
        stage: 'Elevation',
        techniques: [
          'T1047 WMI',
          'T1105 Remote File Copy',
          'T1003 Credential Dumping',
          'T1027 Obfuscated Files or Information',
        ],
        source: 'UTICA',
        target: 'UTICA',
        description:
          'Downloads and runs Mimikatz via a custom WMI class to dump plaintext credentials.',
      },
      {
        step: '16.C',
        stage: 'Remote System Discovery',
        techniques: ['T1078 Valid Accounts', 'T1028 Windows Remote Management'],
        source: 'UTICA',
        target: 'NEWYORK',
        description:
          'Dumped credentials used to open a remote PowerShell session to the domain controller.',
      },
      {
        step: '16.D',
        stage: 'Remote System Discovery',
        techniques: ['T1105 Remote File Copy', 'T1003 Credential Dumping'],
        source: 'UTICA',
        target: 'NEWYORK',
        description: 'Copies Mimikatz to the domain controller and dumps the KRBTGT account hash.',
      },
      {
        step: '20.B',
        stage: 'Leverage Persistence',
        techniques: [
          'T1097 Pass the Ticket',
          'T1028 Windows Remote Management',
          'T1136 Create Account',
        ],
        source: 'UTICA',
        target: 'SCRANTON',
        description:
          'Forges a Kerberos Golden Ticket from the KRBTGT hash, opens a remote session, and creates a new domain account.',
      },
    ],
  },
  {
    id: 'frothly',
    name: 'Frothly (BOTS v3 scenario)',
    actor: 'Unattributed (BOTS v3 CTF scenario)',
    provenance: 'mock',
    sourceLabel: "Modeled on splunk/botsv3's public storyline — mock, not downloaded data",
    steps: [
      {
        step: '1',
        stage: 'Initial Access',
        techniques: ['T1566 Phishing'],
        source: 'attacker',
        target: 'KUTYCH-LAPTOP',
        description: 'Employee (Kevin) opens a malicious attachment, dropping an initial payload.',
      },
      {
        step: '2',
        stage: 'Execution',
        techniques: ['T1059 Command-Line Interface', 'T1204 User Execution'],
        source: 'attacker',
        target: 'KUTYCH-LAPTOP',
        description: 'Payload executes a malicious PowerShell/VBS script on the laptop.',
      },
      {
        step: '3',
        stage: 'Credential Access',
        techniques: ['T1552 Unsecured Credentials'],
        source: 'KUTYCH-LAPTOP',
        target: 'KUTYCH-LAPTOP',
        description:
          'AWS access keys found stored in plaintext files/browser data on the compromised laptop.',
      },
      {
        step: '4',
        stage: 'Initial Access (Cloud)',
        techniques: ['T1078 Valid Accounts', 'T1078.004 Cloud Accounts'],
        source: 'attacker',
        target: 'AWS-ACCOUNT',
        description:
          "Stolen AWS credentials used to authenticate to the victim's AWS account from an external IP.",
      },
      {
        step: '5',
        stage: 'Discovery',
        techniques: ['T1580 Cloud Infrastructure Discovery'],
        source: 'AWS-ACCOUNT',
        target: 'AWS-ACCOUNT',
        description: 'Attacker enumerates EC2 instances, S3 buckets, and IAM users/policies.',
      },
      {
        step: '6',
        stage: 'Resource Hijacking',
        techniques: ['T1496 Resource Hijacking'],
        source: 'AWS-ACCOUNT',
        target: 'EC2-MINER',
        description: 'New/existing EC2 instances repurposed to run cryptomining software.',
      },
      {
        step: '7',
        stage: 'Collection',
        techniques: ['T1530 Data from Cloud Storage'],
        source: 'AWS-ACCOUNT',
        target: 'S3-BUCKET',
        description: 'Sensitive files pulled from an exposed/compromised S3 bucket.',
      },
      {
        step: '8',
        stage: 'Exfiltration',
        techniques: ['T1567 Exfiltration Over Web Service'],
        source: 'S3-BUCKET',
        target: 'attacker',
        description: 'Collected data exfiltrated to attacker-controlled infrastructure.',
      },
      {
        step: '9',
        stage: 'Impact',
        techniques: ['T1531 Account Access Removal'],
        source: 'attacker',
        target: 'AWS-ACCOUNT',
        description:
          'Legitimate IAM users locked out / credentials rotated by the attacker to hinder response.',
      },
    ],
  },
];
