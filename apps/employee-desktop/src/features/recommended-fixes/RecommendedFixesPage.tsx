import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useSecurityScore } from '../../hooks/useSecurityScore';
import type { IncidentSeverity } from '../../types/domain';
import { deriveRecommendedFixes } from './fixEngine';

const SEVERITY_TO_STATUS: Record<IncidentSeverity, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

export function RecommendedFixesPage() {
  const { result, isLoading } = useSecurityScore();

  if (isLoading || !result) {
    return <p className="text-sm text-slate-400">Analyzing this device…</p>;
  }

  const fixes = deriveRecommendedFixes(result);

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-white">Recommended fixes</h2>
      {fixes.length === 0 ? (
        <p className="text-sm text-mirqab-success">No issues found — this device looks healthy.</p>
      ) : (
        <ul className="space-y-3">
          {fixes.map((fix) => (
            <li
              key={fix.id}
              className="flex items-start justify-between gap-4 border-b border-white/5 pb-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-200">{fix.title}</p>
                <p className="mt-1 text-xs text-slate-500">{fix.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge status={SEVERITY_TO_STATUS[fix.severity]}>{fix.severity}</Badge>
                {fix.settingKey && (
                  <Button variant="secondary" onClick={() => window.mirqab.system.openSetting(fix.settingKey!)}>
                    Fix it
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
