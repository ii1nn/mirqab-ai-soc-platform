/** Remediation suggestions keyed by MITRE technique ID — both the Claude prompt grounding and the offline fallback. */
export const FIX_CATALOG: Record<string, string[]> = {
  T1566: [
    'Enable advanced phishing protection and link rewriting on the mail gateway.',
    'Run a targeted phishing-awareness reminder for the affected department.',
    'Block the sender domain at the email gateway.',
  ],
  T1110: [
    'Enforce account lockout after repeated failed attempts.',
    'Require MFA for the affected account.',
    'Force a password reset for the targeted account.',
  ],
  T1204: [
    'Isolate the affected endpoint from the network.',
    'Run a full antivirus/EDR scan on the device.',
    'Block the payload hash across the fleet.',
  ],
  T1046: [
    'Review firewall rules for the scanned network segment.',
    'Confirm the source host is authorized to perform network scans.',
    'Enable IDS alerting for sequential connection attempts.',
  ],
  T1068: [
    'Patch the exploited vulnerability immediately.',
    'Review recently granted administrative privileges.',
    'Enable Windows UAC enforcement if disabled.',
  ],
  T1486: [
    'Isolate affected hosts immediately — do not power off (preserve memory for forensics).',
    'Restore from the most recent known-good backup.',
    'Rotate all credentials used on the affected hosts.',
  ],
  T1071: [
    'Block the destination IP/domain at the network perimeter.',
    'Capture and analyze full packet traffic for the beaconing host.',
    'Isolate the host pending forensic review.',
  ],
  T1053: [
    'Review and remove the unauthorized scheduled task.',
    'Audit task-scheduler permissions on the host.',
    'Check for related persistence mechanisms (services, run keys).',
  ],
  T1078: [
    'Force a credential reset for the affected account.',
    'Review sign-in logs for other anomalous locations/times.',
    'Enable conditional access / impossible-travel alerting.',
  ],
  T1059: [
    'Review PowerShell/script-block logging for the host.',
    'Restrict script execution policy where not required.',
    'Investigate the parent process that spawned the interpreter.',
  ],
  T1105: [
    'Block the download source at the network perimeter.',
    'Quarantine the downloaded file for analysis.',
    'Review egress filtering for the affected host.',
  ],
  T1567: [
    'Block the destination cloud service if unauthorized.',
    'Review DLP policy coverage for the affected data category.',
    'Rotate credentials for any accounts involved in the transfer.',
  ],
};

export const GENERIC_FIXES = [
  'Review the affected device and account for further suspicious activity.',
  'Confirm the finding with the device owner before taking remediation action.',
];
