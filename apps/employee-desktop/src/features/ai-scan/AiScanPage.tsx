import { Loader2, ScanSearch } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { MockBadge } from '../../components/ui/MockBadge';
import { useDeviceMetrics } from '../../hooks/useDeviceMetrics';
import { useProcesses } from '../../hooks/useProcesses';
import { formatRelativeTime } from '../../lib/format';
import { runAiScan } from '../../services/ai-scan.service';
import type { IncidentSeverity, ScanResult } from '../../types/domain';

const SEVERITY_TO_STATUS: Record<IncidentSeverity, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

export function AiScanPage() {
  const { data: metrics } = useDeviceMetrics();
  const { data: processes } = useProcesses();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function handleScan() {
    if (!metrics) return;
    setScanning(true);
    try {
      const scanResult = await runAiScan(metrics, processes ?? []);
      setResult(scanResult);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">AI security scan</h2>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            Analyzes running processes and current protection status. Sends a snapshot to the
            Mirqab backend when available, and falls back to a local heuristic check otherwise.
          </p>
        </div>
        <Button onClick={handleScan} disabled={scanning || !metrics}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          {scanning ? 'Scanning…' : 'Scan now'}
        </Button>
      </Card>

      {result && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Scan results — {formatRelativeTime(result.completedAt)}
            </h3>
            {result.source === 'local-heuristic' && <MockBadge />}
          </div>

          {result.findings.length === 0 ? (
            <p className="text-sm text-mirqab-success">No suspicious activity found.</p>
          ) : (
            <ul className="space-y-3">
              {result.findings.map((finding) => (
                <li
                  key={finding.id}
                  className="flex items-start justify-between gap-4 border-b border-white/5 pb-3"
                >
                  <div>
                    <p className="text-sm text-slate-200">{finding.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{finding.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {finding.isMock && <MockBadge />}
                    <Badge status={SEVERITY_TO_STATUS[finding.severity]}>{finding.severity}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
