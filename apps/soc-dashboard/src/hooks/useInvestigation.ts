import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { incidentsService } from '../services/incidents.service';
import type { IncidentAction, IncidentActionType } from '../types/domain';

export function useInvestigation(incidentId: string | null) {
  return useQuery({
    queryKey: ['incidents', incidentId, 'investigation'],
    queryFn: () => incidentsService.getInvestigation(incidentId as string),
    enabled: Boolean(incidentId),
  });
}

export function useLogIncidentAction(incidentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      type: IncidentActionType;
      outcome?: IncidentAction['outcome'];
      notes?: string;
    }) => incidentsService.logAction(incidentId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'investigation'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'history'] });
    },
  });
}

export function useUpdateIncidentActionOutcome(incidentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ actionId, outcome }: { actionId: string; outcome: IncidentAction['outcome'] }) =>
      incidentsService.updateActionOutcome(incidentId as string, actionId, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'investigation'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'history'] });
    },
  });
}

export function useApplyRecommended(incidentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (types: IncidentActionType[]) =>
      incidentsService.applyRecommended(incidentId as string, types),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'investigation'] });
    },
  });
}

/** Requirement #6: an analyst approving a high-impact AI-recommended action before it can be executed. */
export function useApproveIncidentAction(incidentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (actionId: string) =>
      incidentsService.approveAction(incidentId as string, actionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'investigation'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'history'] });
    },
  });
}

export function useRejectIncidentAction(incidentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ actionId, reason }: { actionId: string; reason?: string }) =>
      incidentsService.rejectAction(incidentId as string, actionId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'investigation'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'history'] });
    },
  });
}

export function useIncidentHistory(incidentId: string | null) {
  return useQuery({
    queryKey: ['incidents', incidentId, 'history'],
    queryFn: () => incidentsService.getHistory(incidentId as string),
    enabled: Boolean(incidentId),
  });
}

export function useUpdateIncidentResolution(incidentId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      rootCause?: string;
      finalResolution?: string;
      lessonsLearned?: string;
    }) => incidentsService.updateResolution(incidentId as string, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'history'] });
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}

/** Real IOC/IOA/C2 findings for this case — see backend detection/indicator.util.ts + c2.util.ts. */
export function useIndicators(incidentId: string | null) {
  return useQuery({
    queryKey: ['incidents', incidentId, 'indicators'],
    queryFn: () => incidentsService.listIndicators(incidentId as string),
    enabled: Boolean(incidentId),
  });
}

export function usePersistenceFindings(incidentId: string | null) {
  return useQuery({
    queryKey: ['incidents', incidentId, 'persistence-findings'],
    queryFn: () => incidentsService.listPersistenceFindings(incidentId as string),
    enabled: Boolean(incidentId),
  });
}

/** Requirement #29 multi-agent audit trail: what each named AI agent decided and why. */
export function useAgentDecisions(incidentId: string | null) {
  return useQuery({
    queryKey: ['incidents', incidentId, 'agent-decisions'],
    queryFn: () => incidentsService.listAgentDecisions(incidentId as string),
    enabled: Boolean(incidentId),
  });
}
