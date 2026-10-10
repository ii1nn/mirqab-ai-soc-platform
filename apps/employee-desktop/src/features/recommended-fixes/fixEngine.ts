import type { RecommendedFix, SecurityScoreResult } from '../../types/domain';

const FIX_CATALOG: Record<string, Omit<RecommendedFix, 'id'>> = {
  defender: {
    title: 'Turn on real-time antivirus protection',
    description:
      'Windows Defender real-time protection is off or disabled. Enable it to catch threats as they run.',
    severity: 'high',
    settingKey: 'windows-defender',
  },
  firewall: {
    title: 'Enable the Windows Firewall',
    description:
      'One or more network profiles have the firewall disabled, exposing this device to network-based attacks.',
    severity: 'high',
    settingKey: 'windows-firewall',
  },
  disk: {
    title: 'Free up disk space',
    description:
      'Low disk space can prevent security updates and event logging from working correctly.',
    severity: 'medium',
  },
  cpu: {
    title: 'Investigate high CPU usage',
    description:
      'Sustained high CPU load can indicate a runaway process or unwanted background activity — check Device Info → Processes.',
    severity: 'low',
  },
};

/** Every fix here traces back to a failing check in the real security score — nothing invented. */
export function deriveRecommendedFixes(result: SecurityScoreResult): RecommendedFix[] {
  return result.checks
    .filter((check) => check.status === 'danger' || check.status === 'warning')
    .map((check) => {
      const template = FIX_CATALOG[check.id];
      return {
        id: check.id,
        title: template?.title ?? check.label,
        description: template?.description ?? check.detail,
        severity: check.status === 'danger' ? 'high' : 'medium',
        settingKey: template?.settingKey,
      } satisfies RecommendedFix;
    });
}
