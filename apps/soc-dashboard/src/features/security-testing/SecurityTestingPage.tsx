import { CheckCircle2, PlayCircle, ShieldAlert, XCircle } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useRunSecurityTests } from '../../hooks/useSecurityTesting';
import { formatDateTime } from '../../lib/format';
import type { SecurityTestResult } from '../../types/domain';

/**
 * Requirement #32 — Security Testing Mode. ADMIN-only page (gated in App.tsx
 * via RequireRole and hidden from the sidebar for non-admins) that triggers a
 * live, on-demand run of Mirqab's own defensive code paths against safe
 * synthetic fixtures. This is not an offensive tool: there is nothing here
 * that exploits, scans, or attacks anything — see backend SecurityTestingService.
 */
export function SecurityTestingPage() {
  const runTests = useRunSecurityTests();
  const report = runTests.data;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-mirqab-accent" />
            <div>
              <h2 className="text-sm font-semibold text-white">Security Testing Mode</h2>
              <p className="mt-1 max-w-2xl text-xs text-slate-400">
                Runs Mirqab's real detection, AI-security, and authorization code paths against safe
                synthetic fixtures — no exploitation capability, no data left behind. The one check
                needing a persisted row creates a tagged transient test incident and deletes it
                immediately after.
              </p>
            </div>
          </div>
          <Button
            disabled={runTests.isPending}
            onClick={() => runTests.mutate()}
            className="shrink-0"
          >
            <PlayCircle className="h-4 w-4" />
            {runTests.isPending ? 'Running…' : 'Run security tests'}
          </Button>
        </div>

        {runTests.isError && (
          <p className="mt-3 text-xs text-mirqab-danger">
            Couldn't run the test suite. Confirm the backend is reachable and this account has the
            Admin role.
          </p>
        )}
      </Card>

      {report && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <Metric label="Total checks" value={report.summary.total} />
                <Metric label="Passed" value={report.summary.passed} tone="success" />
                <Metric label="Failed" value={report.summary.failed} tone="danger" />
              </div>
              <p className="text-xs text-slate-500">Run at {formatDateTime(report.runAt)}</p>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-white">Results</h3>
            <ul className="space-y-2">
              {report.results.map((result) => (
                <ResultRow key={result.name} result={result} />
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={
          tone === 'success'
            ? 'mt-1 text-xl font-semibold text-mirqab-success'
            : tone === 'danger'
              ? 'mt-1 text-xl font-semibold text-mirqab-danger'
              : 'mt-1 text-xl font-semibold text-white'
        }
      >
        {value}
      </p>
    </div>
  );
}

function ResultRow({ result }: { result: SecurityTestResult }) {
  return (
    <li className="rounded-xl2 border border-white/5 bg-white/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {result.passed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mirqab-success" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-mirqab-danger" />
          )}
          <div>
            <p className="text-sm font-medium text-slate-100">{result.name}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              {result.category}
            </p>
          </div>
        </div>
        <Badge status={result.passed ? 'success' : 'danger'}>
          {result.passed ? 'Pass' : 'Fail'}
        </Badge>
      </div>
      <p className="mt-2 ps-6 text-xs text-slate-400">{result.detail}</p>
    </li>
  );
}
