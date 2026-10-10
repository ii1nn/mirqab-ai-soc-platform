import { AnimatePresence, motion } from 'framer-motion';
import { Activity, AlertTriangle, Bell, ScrollText, Ticket as TicketIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Card } from '../../components/ui/Card';
import { SEVERITY_COLOR } from '../../components/ui/Badge';
import { useAuditLogs } from '../../hooks/useAuditLogs';
import { useDepartments } from '../../hooks/useDepartments';
import { useIncidents } from '../../hooks/useIncidents';
import { usePolicies } from '../../hooks/usePolicies';
import { useTickets } from '../../hooks/useTickets';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatRelativeTime } from '../../lib/format';
import { ResponseNotificationsList } from './ResponseNotificationsList';

type NotificationType = 'incident' | 'ticket' | 'policy' | 'audit';

interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  subtitle: string;
  timestamp: string;
  color: string;
}

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  incident: AlertTriangle,
  ticket: TicketIcon,
  policy: ScrollText,
  audit: Activity,
};

const TYPE_COLOR: Record<NotificationType, string> = {
  incident: '#FF3B5C',
  ticket: '#EC4899',
  policy: '#7C3AED',
  audit: '#3B82F6',
};

export function NotificationsPage() {
  const { t } = useLanguage();
  const { data: incidents = [] } = useIncidents();
  const { data: tickets = [] } = useTickets();
  const { data: policies = [] } = usePolicies();
  const { data: auditLogs = [] } = useAuditLogs();
  const { data: departments = [] } = useDepartments();
  const [filter, setFilter] = useState<'all' | NotificationType>('all');

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? t('notifications.unknownDepartment');
  }

  const items = useMemo<NotificationItem[]>(() => {
    const incidentItems: NotificationItem[] = incidents.map((incident) => ({
      id: `incident-${incident.id}`,
      type: 'incident',
      title: incident.title,
      subtitle: `${departmentName(incident.departmentId)} · ${incident.technique.id} ${incident.technique.name}`,
      timestamp: incident.createdAt,
      color: SEVERITY_COLOR[incident.severity] ?? TYPE_COLOR.incident,
    }));

    const ticketItems: NotificationItem[] = tickets.map((ticket) => ({
      id: `ticket-${ticket.id}`,
      type: 'ticket',
      title: ticket.title,
      subtitle: `${t('notifications.ticketStatus')}: ${ticket.status}`,
      timestamp: ticket.updatedAt,
      color: TYPE_COLOR.ticket,
    }));

    const policyItems: NotificationItem[] = policies.map((policy) => ({
      id: `policy-${policy.id}`,
      type: 'policy',
      title: policy.name,
      subtitle: policy.enabled
        ? t('notifications.policyEnabled')
        : t('notifications.policyDisabled'),
      timestamp: policy.updatedAt,
      color: TYPE_COLOR.policy,
    }));

    const auditItems: NotificationItem[] = auditLogs.map((entry) => ({
      id: `audit-${entry.id}`,
      type: 'audit',
      title: entry.action,
      subtitle: entry.target ? `${entry.actorEmail} → ${entry.target}` : entry.actorEmail,
      timestamp: entry.timestamp,
      color: TYPE_COLOR.audit,
    }));

    return [...incidentItems, ...ticketItems, ...policyItems, ...auditItems].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [incidents, tickets, policies, auditLogs, departments, t]);

  const filtered = filter === 'all' ? items : items.filter((item) => item.type === filter);

  const tabs: Array<{ key: 'all' | NotificationType; label: string }> = [
    { key: 'all', label: t('notifications.filters.all') },
    { key: 'incident', label: t('notifications.filters.incident') },
    { key: 'ticket', label: t('notifications.filters.ticket') },
    { key: 'policy', label: t('notifications.filters.policy') },
    { key: 'audit', label: t('notifications.filters.audit') },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">{t('notifications.title')}</h1>
        <p className="text-sm text-slate-400">{t('notifications.subtitle')}</p>
      </div>

      <ResponseNotificationsList />

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
              filter === tab.key
                ? 'border-mirqab-accent/50 bg-mirqab-accent/20 text-white shadow-glow-sm'
                : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500">{t('notifications.empty')}</p>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {filtered.slice(0, 60).map((item) => {
                const Icon = TYPE_ICON[item.type];
                return (
                  <motion.li
                    key={item.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-start gap-3 rounded-xl2 border border-white/5 bg-white/5 p-3"
                  >
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: `${item.color}22`, color: item.color }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{item.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{item.subtitle}</p>
                    </div>
                    <p className="shrink-0 text-[11px] text-slate-600">
                      {formatRelativeTime(item.timestamp)}
                    </p>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </Card>
    </div>
  );
}
