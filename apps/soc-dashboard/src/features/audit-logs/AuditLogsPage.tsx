import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useAuditLogs } from '../../hooks/useAuditLogs';
import { formatDateTime } from '../../lib/format';

export function AuditLogsPage() {
  const { data: entries = [], isLoading, isError, refetch } = useAuditLogs();
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          !search ||
          entry.action.toLowerCase().includes(search.toLowerCase()) ||
          entry.actorEmail.toLowerCase().includes(search.toLowerCase()),
      ),
    [entries, search],
  );

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by action or actor…"
          className="w-64 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-mirqab-accent/50"
        />
        <p className="text-xs text-slate-500">
          Real, persistent audit trail — sign-in/out, ticket and policy changes, and user activation
          all write here server-side.
        </p>
      </Card>

      {isError ? (
        <ErrorState
          description="Couldn't load the audit trail from the backend."
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
        {isLoading ? (
          <LoadingState label="Loading audit logs…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No actions recorded yet"
            description={
              search ? 'No entries match your search.' : 'Audit events will appear here as they occur.'
            }
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Timestamp</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="text-slate-300">{entry.actorEmail}</Td>
                  <Td className="text-slate-200">{entry.action}</Td>
                  <Td className="text-slate-500">{entry.target ?? '—'}</Td>
                  <Td className="text-slate-500">{formatDateTime(entry.timestamp)}</Td>
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
