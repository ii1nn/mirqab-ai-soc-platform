import { TrainingRecord } from './training-record.interface';

/**
 * Labeled records for the AI classifier training-record pipeline
 * (Integration Phase 4). Static data, same convention as
 * mitre-reference.data.ts/fix-catalog.data.ts — no database table, no
 * runtime file I/O. Never fed into AiService.analyzeLog()/the live Incident
 * pipeline; consumed only by TrainingBenchmarkService as a labeled
 * classifier accuracy check (see that file and this phase's doc).
 *
 * One real record, parsed from the actual downloaded sample (see
 * datasets/EVTX-to-MITRE-Attack/NOTES.md); five synthetic records modeled
 * on splunk/attack_data's real technique/tool taxonomy but not derived from
 * its (Git-LFS-locked, never downloaded) content — see
 * datasets/attack_data/NOTES.md for why nothing from that repo was
 * downloaded. Every excerpt below is an accurate plain-language description
 * of the event, not keyword-stuffed to force a match — see the Phase 4 doc
 * for the resulting classifier accuracy, including the one case (the real
 * EVTX record) where the simple keyword matcher does NOT recognize the
 * label, reported honestly rather than rephrased until it does.
 */
export const TRAINING_RECORDS: TrainingRecord[] = [
  {
    id: 'evtx-t1078-4625',
    provenance: 'real',
    datasetOrigin:
      'mdecrevoisier/EVTX-to-MITRE-Attack — TA0001-Initial access/T1078-Valid accounts (CC0-1.0)',
    sourceExcerpt:
      'Windows Security Event 4625: an account failed to log on. Logon type 10 (RemoteInteractive/RDP). ' +
      'Failure reason: Unknown user name or bad password (status 0xC000006E). Subject: FS03$ (SYSTEM, logon ID 0x3E7). ' +
      'Caller process: winlogon.exe. Source network address: 10.23.23.9, source port 0. Authentication package: Negotiate.',
    label: {
      mitreTechniqueId: 'T1078',
      mitreTechniqueName: 'Valid Accounts',
      mitreTactic: 'Persistence',
    },
    metadata: {
      eventId: '4625',
      logonType: '10',
      sourceNetworkAddress: '10.23.23.9',
      callerProcess: 'winlogon.exe',
      subjectAccount: 'FS03$',
    },
    timeline: [
      {
        timestamp: '2021-10-24T00:51:57.000Z',
        event: 'Logon attempt denied — account restriction',
      },
    ],
  },
  {
    id: 'synthetic-t1110-brute-force',
    provenance: 'synthetic',
    datasetOrigin:
      'Modeled on splunk/attack_data technique taxonomy (synthetic — see datasets/attack_data/NOTES.md)',
    sourceExcerpt:
      'Sysmon detected 42 failed authentication attempts against user administrator from a single source host ' +
      'within 90 seconds, followed by a successful login — consistent with a password guessing attack.',
    label: {
      mitreTechniqueId: 'T1110',
      mitreTechniqueName: 'Brute Force',
      mitreTactic: 'Credential Access',
    },
    metadata: { targetUser: 'administrator', attemptCount: '42', windowSeconds: '90' },
    timeline: [
      { timestamp: '2026-01-10T03:14:00.000Z', event: 'Failed logon burst begins' },
      { timestamp: '2026-01-10T03:15:30.000Z', event: 'Successful logon after 42 failures' },
    ],
  },
  {
    id: 'synthetic-t1105-ingress-tool-transfer',
    provenance: 'synthetic',
    datasetOrigin:
      'Modeled on splunk/attack_data technique taxonomy (synthetic — see datasets/attack_data/NOTES.md)',
    sourceExcerpt:
      'An external attacker used a certutil download to perform a remote file copy of an executable tool onto ' +
      'the host, saving it to the Downloads folder before execution.',
    label: {
      mitreTechniqueId: 'T1105',
      mitreTechniqueName: 'Ingress Tool Transfer',
      mitreTactic: 'Command and Control',
    },
    metadata: { tool: 'certutil', destinationPath: '%USERPROFILE%\\Downloads' },
    timeline: [{ timestamp: '2026-01-10T03:16:05.000Z', event: 'Tool downloaded and executed' }],
  },
  {
    id: 'synthetic-t1059-encoded-powershell',
    provenance: 'synthetic',
    datasetOrigin:
      'Modeled on splunk/attack_data technique taxonomy (synthetic — see datasets/attack_data/NOTES.md)',
    sourceExcerpt:
      'An obfuscated PowerShell script ran a base64 encoded command spawned from cmd.exe to bypass logging.',
    label: {
      mitreTechniqueId: 'T1059',
      mitreTechniqueName: 'Command and Scripting Interpreter',
      mitreTactic: 'Execution',
    },
    metadata: { interpreter: 'powershell.exe', parentProcess: 'cmd.exe' },
    timeline: [
      { timestamp: '2026-01-10T03:17:40.000Z', event: 'Encoded PowerShell command executed' },
    ],
  },
  {
    id: 'synthetic-t1053-scheduled-task',
    provenance: 'synthetic',
    datasetOrigin:
      'Modeled on splunk/attack_data technique taxonomy (synthetic — see datasets/attack_data/NOTES.md)',
    sourceExcerpt:
      'Attacker persistence established via a new scheduled task created to relaunch the payload at every user logon.',
    label: {
      mitreTechniqueId: 'T1053',
      mitreTechniqueName: 'Scheduled Task/Job',
      mitreTactic: 'Persistence',
    },
    metadata: { taskTrigger: 'user logon' },
    timeline: [{ timestamp: '2026-01-10T03:18:10.000Z', event: 'Scheduled task created' }],
  },
  {
    id: 'synthetic-t1071-c2-beaconing',
    provenance: 'synthetic',
    datasetOrigin:
      'Modeled on splunk/attack_data technique taxonomy (synthetic — see datasets/attack_data/NOTES.md)',
    sourceExcerpt:
      'Outbound HTTPS beaconing to an unknown external IP observed at regular intervals, consistent with command ' +
      'and control callback traffic.',
    label: {
      mitreTechniqueId: 'T1071',
      mitreTechniqueName: 'Application Layer Protocol',
      mitreTactic: 'Command and Control',
    },
    metadata: { protocol: 'HTTPS', intervalSeconds: '60' },
    timeline: [{ timestamp: '2026-01-10T03:19:00.000Z', event: 'Beaconing pattern detected' }],
  },
];
