import { Severity } from '@prisma/client';

/**
 * Deterministic, regex/keyword detection over real evidence text — the same
 * philosophy as ../enrichment/incident-enrichment.util.ts. No external
 * telemetry API, no invented findings: absence of a matching pattern means
 * an empty result, never a guessed one. Confidence is a heuristic (more
 * corroborating signals = higher, capped below 100 since this is pattern
 * matching over log text, not verified endpoint state).
 */

export type PersistenceType =
  | 'SCHEDULED_TASK'
  | 'WINDOWS_SERVICE'
  | 'STARTUP_FOLDER'
  | 'REGISTRY_RUN_KEY'
  | 'WMI_SUBSCRIPTION'
  | 'LOGIN_SCRIPT'
  | 'CRON_JOB'
  | 'POWERSHELL_PROFILE'
  | 'ACCOUNT_CREDENTIAL_CHANGE'
  | 'OTHER';

export interface PersistenceFindingCandidate {
  type: PersistenceType;
  evidenceText: string;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  mitreTactic: string;
  confidence: number;
  risk: Severity;
  process: string | null;
  command: string | null;
}

interface PersistenceRule {
  type: PersistenceType;
  pattern: RegExp;
  mitreTechniqueId: string;
  mitreTechniqueName: string;
  baseConfidence: number;
}

// Real, correctly-documented MITRE ATT&CK technique IDs — a superset of the
// narrow MITRE_REFERENCE list the Claude classifier is constrained to (that
// list stays small on purpose; persistence findings are deterministic, not
// LLM output, so they aren't bound by the same enum).
const RULES: PersistenceRule[] = [
  {
    type: 'SCHEDULED_TASK',
    pattern: /\b(schtasks|scheduled task|task scheduler|new-scheduledtask)\b/i,
    mitreTechniqueId: 'T1053.005',
    mitreTechniqueName: 'Scheduled Task/Job: Scheduled Task',
    baseConfidence: 70,
  },
  {
    type: 'CRON_JOB',
    pattern: /\b(crontab|\/etc\/cron|cron job)\b/i,
    mitreTechniqueId: 'T1053.003',
    mitreTechniqueName: 'Scheduled Task/Job: Cron',
    baseConfidence: 70,
  },
  {
    type: 'WINDOWS_SERVICE',
    pattern:
      /\b(sc\.exe create|sc create|new-service|service installed|malicious service created)\b/i,
    mitreTechniqueId: 'T1543.003',
    mitreTechniqueName: 'Create or Modify System Process: Windows Service',
    baseConfidence: 70,
  },
  {
    type: 'STARTUP_FOLDER',
    pattern: /\b(startup folder|shell:startup|\\start menu\\programs\\startup)\b/i,
    mitreTechniqueId: 'T1547.001',
    mitreTechniqueName: 'Boot or Logon Autostart Execution: Registry Run Keys / Startup Folder',
    baseConfidence: 65,
  },
  {
    type: 'REGISTRY_RUN_KEY',
    pattern: /\b(hk(cu|lm)\\.*\\run\b|runonce\b|reg add .*\\run)\b/i,
    mitreTechniqueId: 'T1547.001',
    mitreTechniqueName: 'Boot or Logon Autostart Execution: Registry Run Keys / Startup Folder',
    baseConfidence: 75,
  },
  {
    type: 'WMI_SUBSCRIPTION',
    pattern:
      /\b(wmi subscription|__eventfilter|__eventconsumer|register-wmievent|wmic .*call create)\b/i,
    mitreTechniqueId: 'T1546.003',
    mitreTechniqueName:
      'Event Triggered Execution: Windows Management Instrumentation Event Subscription',
    baseConfidence: 75,
  },
  {
    type: 'LOGIN_SCRIPT',
    pattern: /\b(logon script|userinitmprlogonscript|netlogon script)\b/i,
    mitreTechniqueId: 'T1037.001',
    mitreTechniqueName: 'Boot or Logon Initialization Scripts: Logon Script (Windows)',
    baseConfidence: 65,
  },
  {
    type: 'POWERSHELL_PROFILE',
    pattern: /\b(\$profile|profile\.ps1 modified|powershell profile)\b/i,
    mitreTechniqueId: 'T1546.013',
    mitreTechniqueName: 'Event Triggered Execution: PowerShell Profile',
    baseConfidence: 65,
  },
  {
    type: 'ACCOUNT_CREDENTIAL_CHANGE',
    pattern:
      /\b(new administrator account|added to (the )?administrators group|password never expires|account added to domain admins)\b/i,
    mitreTechniqueId: 'T1098',
    mitreTechniqueName: 'Account Manipulation',
    baseConfidence: 65,
  },
];

// Corroborating signals that raise confidence and risk when found alongside
// a base persistence pattern — obfuscation/encoding is a strong indicator
// this isn't routine admin activity. No leading `\b` before the `-` flags:
// `-` isn't a word character, so a boundary assertion immediately before it
// can never match when preceded by whitespace (a real bug caught by
// persistence.util.spec.ts, not just review).
const AGGRAVATING_PATTERN =
  /(-enc\b|-encodedcommand\b|frombase64string|iex\s*\(|invoke-expression|hidden window)/i;

const PROCESS_PATTERN = /\b([a-z0-9_-]+\.exe)\b/i;
const COMMAND_LINE_PATTERN =
  /(powershell(?:\.exe)?\s+.{0,200}|cmd(?:\.exe)?\s+\/c\s+.{0,200}|schtasks\s+.{0,200}|sc\s+create\s+.{0,200}|reg\s+add\s+.{0,200})/i;

export function detectPersistence(text: string): PersistenceFindingCandidate[] {
  const findings: PersistenceFindingCandidate[] = [];
  const aggravated = AGGRAVATING_PATTERN.test(text);
  const processMatch = text.match(PROCESS_PATTERN);
  const commandMatch = text.match(COMMAND_LINE_PATTERN);

  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;

    const confidence = Math.min(95, rule.baseConfidence + (aggravated ? 20 : 0));
    const risk: Severity = aggravated
      ? Severity.HIGH
      : confidence >= 70
        ? Severity.MEDIUM
        : Severity.LOW;

    findings.push({
      type: rule.type,
      evidenceText: match[0],
      mitreTechniqueId: rule.mitreTechniqueId,
      mitreTechniqueName: rule.mitreTechniqueName,
      mitreTactic: 'Persistence',
      confidence,
      risk,
      process: processMatch ? processMatch[1] : null,
      command: commandMatch ? commandMatch[0].trim().slice(0, 500) : null,
    });
  }

  return findings;
}
