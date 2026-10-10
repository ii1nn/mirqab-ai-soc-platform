import { useMemo, useState } from 'react';
import { Ticket as TicketIcon } from 'lucide-react';
import { SEVERITY_COLOR, SeverityBadge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useDepartments } from '../../hooks/useDepartments';
import { useReassignTicket, useTickets, useUpdateTicketStatus } from '../../hooks/useTickets';
import { ASSIGNEES } from '../../lib/assignees';
import { formatDateTime } from '../../lib/format';
import type { TicketStatus } from '../../types/domain';

const STATUS_TABS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_OPTIONS: TicketStatus[] = ['open', 'in-progress', 'resolved', 'closed'];

export function TicketsPage() {
  const { data: tickets = [], isLoading, isError, refetch } = useTickets();
  const { data: departments = [] } = useDepartments();
  const updateTicketStatus = useUpdateTicketStatus();
  const reassignTicket = useReassignTicket();
  const [tab, setTab] = useState<TicketStatus | 'all'>('all');

  const filtered = useMemo(
    () => (tab === 'all' ? tickets : tickets.filter((ticket) => ticket.status === tab)),
    [tickets, tab],
  );

  function departmentName(id: string | null): string {
    return departments.find((dept) => dept.id === id)?.name ?? 'Unknown department';
  }

  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-xl bg-white/5 p-1">
        {STATUS_TABS.map((item) => (
          <button
            key={item.value}
            onClick={() => setTab(item.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === item.value
                ? 'bg-mirqab-accent text-mirqab-primary'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Card>
          <LoadingState label="Loading tickets…" />
        </Card>
      ) : isError ? (
        <ErrorState
          description="Couldn't load tickets from the backend."
          action={
            <button
              onClick={() => refetch()}
              className="text-xs font-medium text-mirqab-accent hover:underline"
            >
              Retry
            </button>
          }
        />
      ) : (
      <Card>
        {filtered.length === 0 ? (
          <EmptyState
            icon={TicketIcon}
            title="No tickets in this view"
            description="High/critical alerts automatically open a ticket — start Simulation Mode from the topbar to generate some."
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Ticket</Th>
                <Th>Department</Th>
                <Th>Severity</Th>
                <Th>Assignee</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((ticket) => (
                <Tr
                  key={ticket.id}
                  style={{ borderInlineStartColor: SEVERITY_COLOR[ticket.severity] }}
                  className="border-s-4 border-transparent"
                >
                  <Td className="text-slate-200">{ticket.title}</Td>
                  <Td className="text-slate-400">{departmentName(ticket.departmentId)}</Td>
                  <Td>
                    <SeverityBadge severity={ticket.severity} />
                  </Td>
                  <Td>
                    <select
                      value={ticket.assignee ?? 'Unassigned'}
                      onChange={(event) =>
                        reassignTicket.mutate({ id: ticket.id, assignee: event.target.value })
                      }
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200"
                    >
                      {ASSIGNEES.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    <select
                      value={ticket.status}
                      onChange={(event) =>
                        updateTicketStatus.mutate({
                          id: ticket.id,
                          status: event.target.value as TicketStatus,
                        })
                      }
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs capitalize text-slate-200"
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td className="text-slate-500">{formatDateTime(ticket.updatedAt)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
      )}
    </div>
  );
}
