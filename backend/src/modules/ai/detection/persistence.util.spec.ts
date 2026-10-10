import { Severity } from '@prisma/client';
import { detectPersistence } from './persistence.util';

describe('detectPersistence', () => {
  it('detects a scheduled task and maps to T1053.005', () => {
    const findings = detectPersistence(
      'A newly created scheduled task launches an encoded PowerShell command. schtasks /create /tn "Updater" -EncodedCommand ABC123',
    );

    const scheduledTask = findings.find((f) => f.type === 'SCHEDULED_TASK');
    expect(scheduledTask).toBeDefined();
    expect(scheduledTask?.mitreTechniqueId).toBe('T1053.005');
    expect(scheduledTask?.mitreTactic).toBe('Persistence');
    // Encoded command corroborates the finding — confidence and risk both step up.
    expect(scheduledTask?.confidence).toBeGreaterThanOrEqual(85);
    expect(scheduledTask?.risk).toBe(Severity.HIGH);
  });

  it('detects a registry Run key persistence mechanism', () => {
    const findings = detectPersistence(
      'Attacker added HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run entry for malware.exe',
    );

    const regKey = findings.find((f) => f.type === 'REGISTRY_RUN_KEY');
    expect(regKey).toBeDefined();
    expect(regKey?.mitreTechniqueId).toBe('T1547.001');
  });

  it('detects WMI event subscription persistence', () => {
    const findings = detectPersistence(
      'Adversary registered a __EventFilter and __EventConsumer for WMI subscription persistence.',
    );

    expect(findings.some((f) => f.type === 'WMI_SUBSCRIPTION')).toBe(true);
  });

  it('returns an empty array when there is no persistence evidence (never claims a false positive)', () => {
    const findings = detectPersistence('The weekly report was generated successfully today.');
    expect(findings).toEqual([]);
  });

  it('extracts the process and command line when present', () => {
    const findings = detectPersistence(
      'powershell.exe -NoProfile -EncodedCommand ABC123 to register a new scheduled task via schtasks /create',
    );
    const finding = findings.find((f) => f.type === 'SCHEDULED_TASK');
    expect(finding?.process).toBe('powershell.exe');
    expect(finding?.command).toContain('powershell');
  });
});
