import { AlertTriangle, Bell, ShieldCheck, ShieldOff, ShieldX } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SeverityBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LtrText } from '../../components/ui/LtrText';
import { useNotifications } from '../../hooks/useNotifications';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatDateTime, formatRelativeTime, formatResponseCountdown } from '../../lib/format';
import { remainingNotificationMs } from '../../lib/sla';
import type { ContainmentNotificationResult, SocNotification } from '../../types/domain';

/** Only used to cap the visual MM:SS — the deadline itself always comes
 * from the backend (notification.incident.responseDeadline). */
const WINDOW_DISPLAY_CAP_MS = 5 * 60 * 1000;

const RESULT_KEY: Record<ContainmentNotificationResult, string> = {
  succeeded: 'notifications.response.resultSucceeded',
  failed: 'notifications.response.resultFailed',
  unavailable: 'notifications.response.resultUnavailable',
  'policy-disabled': 'notifications.response.resultPolicyDisabled',
};

const RESULT_ICON: Record<ContainmentNotificationResult, typeof Bell> = {
  succeeded: ShieldCheck,
  failed: ShieldX,
  unavailable: ShieldOff,
  'policy-disabled': ShieldOff,
};

function useTick(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

/**
 * Backend Notification rows for the 5-minute response window (GET
 * /notifications — organization/department scoped server-side). Every
 * sentence is rendered here from structured fields in the active language;
 * technical values (Case ID, hostname, timestamps, countdown) are isolated
 * as LTR so Arabic layout never reorders them.
 */
export function ResponseNotificationsList() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useNotifications();
  const items = data?.items ?? [];

  const anyCountdown = items.some(
    (item) =>
      item.kind === 'response-required' && !item.incident.acknowledgedAt && remainingNotificationMs(item) > 0,
  );
  const now = useTick(anyCountdown);

  return (
    <Card>
      <div className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Bell className="h-4 w-4 text-mirqab-accent" />
          {t('notifications.response.sectionTitle')}
        </h2>
        <p className="text-xs text-slate-400">{t('notifications.response.sectionSubtitle')}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : isError ? (
        <p className="text-sm text-mirqab-danger">{t('notifications.response.loadFailed')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{t('notifications.response.empty')}</p>
      ) : (
        <ul className="space-y-2" data-testid="response-notifications">
          {items.slice(0, 50).map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              now={now}
              t={t}
              onOpen={() => navigate(`/alerts?incidentId=${item.incident.id}`)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function NotificationRow({
  item,
  now,
  t,
  onOpen,
}: {
  item: SocNotification;
  now: number;
  t: (key: string) => string;
  onOpen: () => void;
}) {
  const device = item.incident.deviceName ?? t('notifications.response.unknownDevice');

  if (item.kind === 'legacy') {
    return (
      <li className="flex items-start gap-3 rounded-xl2 border border-white/5 bg-white/5 p-3" data-kind="legacy">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-slate-200">
            <LtrText>{item.fallbackTitle}</LtrText>
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            <LtrText>{item.fallbackBody}</LtrText>
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-slate-600">{formatRelativeTime(item.createdAt)}</span>
      </li>
    );
  }

  const isRequired = item.kind === 'response-required';
  const result = item.containmentResult;
  const Icon = isRequired ? AlertTriangle : result ? RESULT_ICON[result] : ShieldOff;
  const color = isRequired
    ? 'text-mirqab-warning'
    : result === 'succeeded'
      ? 'text-mirqab-success'
      : 'text-mirqab-danger';

  let windowLabel: ReactNode = null;
  if (isRequired) {
    const remaining = remainingNotificationMs(item, now);
    windowLabel = item.incident.acknowledgedAt ? (
      <span className="text-mirqab-success">{t('notifications.response.acknowledged')}</span>
    ) : remaining > 0 ? (
      <span>
        {t('notifications.response.remaining')}:{' '}
        <LtrText className="font-mono font-semibold text-mirqab-warning">
          {formatResponseCountdown(remaining, WINDOW_DISPLAY_CAP_MS)}
        </LtrText>
      </span>
    ) : (
      <span className="text-mirqab-danger">{t('notifications.response.expired')}</span>
    );
  }

  return (
    <li
      className="rounded-xl2 border border-white/5 bg-white/5 p-3"
      data-kind={item.kind}
      data-result={result ?? undefined}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-slate-100">
            {isRequired ? (
              <>
                {t('notifications.response.requiredTitle')} <LtrText>{device}</LtrText>
              </>
            ) : (
              t('notifications.response.containmentTitle')
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-300">
            {isRequired ? (
              t('notifications.response.requiredBody')
            ) : (
              <>
                {t('notifications.response.containmentReason')} <LtrText>{item.incident.caseId}</LtrText> (
                <LtrText>{device}</LtrText>). {result ? t(RESULT_KEY[result]) : null}
              </>
            )}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-400 sm:grid-cols-4">
            <div>
              <dt>{t('notifications.response.caseId')}</dt>
              <dd className="text-slate-200">
                <LtrText className="font-mono">{item.incident.caseId}</LtrText>
              </dd>
            </div>
            <div>
              <dt>{t('notifications.response.severity')}</dt>
              <dd>
                <SeverityBadge severity={item.incident.severity} />
              </dd>
            </div>
            <div>
              <dt>{t('notifications.response.department')}</dt>
              <dd className="text-slate-200">
                {item.incident.departmentName ? <LtrText>{item.incident.departmentName}</LtrText> : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('notifications.response.deadline')}</dt>
              <dd className="text-slate-200">
                <LtrText>{formatDateTime(item.incident.responseDeadline)}</LtrText>
              </dd>
            </div>
          </dl>
          {!isRequired && result === 'failed' && (
            <p className="mt-1 text-[11px] text-slate-500">
              {t('notifications.response.detail')}: <LtrText>{item.fallbackBody}</LtrText>
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span data-testid="notification-window">{windowLabel}</span>
            <Button size="sm" variant="secondary" onClick={onOpen}>
              {t('notifications.response.openIncident')}
            </Button>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-slate-600">
          <LtrText>{formatRelativeTime(item.createdAt)}</LtrText>
        </span>
      </div>
    </li>
  );
}
