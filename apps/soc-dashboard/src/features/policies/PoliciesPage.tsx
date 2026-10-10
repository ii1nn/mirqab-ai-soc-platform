import { Card } from '../../components/ui/Card';
import { useLanguage } from '../../i18n/LanguageContext';
import { usePolicies, useTogglePolicy } from '../../hooks/usePolicies';
import { formatDateTime } from '../../lib/format';

export function PoliciesPage() {
  const { dir } = useLanguage();
  const { data: policies = [], isLoading } = usePolicies();
  const toggle = useTogglePolicy();

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading policies…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Persisted in the backend — toggling here updates Postgres immediately and is recorded in
        Audit Logs.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {policies.map((policy) => (
          <Card key={policy.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">{policy.category}</p>
                <h3 className="text-sm font-semibold text-white">{policy.name}</h3>
              </div>
              <button
                onClick={() => toggle.mutate(policy.id)}
                disabled={toggle.isPending}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                  policy.enabled ? 'bg-mirqab-success/70' : 'bg-white/10'
                }`}
                aria-label={`Toggle ${policy.name}`}
              >
                {/* translate-x-* is a PHYSICAL-direction transform (always
                    rightward for a positive value) and the knob previously
                    had no explicit logical anchor, so its RTL resting
                    position depended on the browser's `auto` fallback while
                    "ON" kept pushing further in the same physical direction
                    — the knob never crossed to the opposite side in Arabic.
                    start-0.5 anchors it logically (flips correctly with
                    dir), and the transform's sign is computed from the
                    actual resolved direction rather than assumed. */}
                <span
                  className="absolute start-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
                  style={{
                    transform: policy.enabled
                      ? `translateX(${dir === 'rtl' ? '-20px' : '20px'})`
                      : 'translateX(0)',
                  }}
                />
              </button>
            </div>

            <p className="text-xs text-slate-400">{policy.description}</p>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>Compliance</span>
                <span>{policy.compliancePercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${
                    policy.compliancePercent >= 80 ? 'bg-mirqab-success' : 'bg-mirqab-warning'
                  }`}
                  style={{ width: `${policy.compliancePercent}%` }}
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-600">Updated {formatDateTime(policy.updatedAt)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
