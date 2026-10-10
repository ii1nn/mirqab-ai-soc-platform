import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { incidentsService } from '../services/incidents.service';
import type { IncidentStatus } from '../types/domain';

export function useIncidents() {
  return useQuery({
    queryKey: ['incidents'],
    queryFn: incidentsService.list,
    // Real-time push (useRealtimeSync) invalidates this on every
    // incident.created/updated event — this interval is just a safety net
    // for a missed socket event or a reconnect gap, not the primary path.
    refetchInterval: 30_000,
  });
}

export function useIncident(id: string | null) {
  return useQuery({
    queryKey: ['incidents', id],
    queryFn: () => incidentsService.get(id as string),
    enabled: Boolean(id),
  });
}

export function useSimilarIncidents(id: string | null) {
  return useQuery({
    queryKey: ['incidents', id, 'similar'],
    queryFn: () => incidentsService.findSimilar(id as string),
    enabled: Boolean(id),
  });
}

export function useUpdateIncidentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IncidentStatus }) =>
      incidentsService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

/** "Acknowledge & Investigate" — POST /ai/incidents/:id/acknowledge. The
 * backend decides everything (idempotency, late responses, whether
 * containment already happened); the UI just refreshes to its answer. */
export function useAcknowledgeIncident() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => incidentsService.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useGenerateAnalystReport() {
  return useMutation({
    mutationFn: (id: string) => incidentsService.generateAnalystReport(id),
  });
}
