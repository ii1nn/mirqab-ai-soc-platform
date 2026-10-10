import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsService } from '../services/tickets.service';
import type { TicketStatus } from '../types/domain';

export function useTickets() {
  return useQuery({
    queryKey: ['tickets'],
    queryFn: ticketsService.list,
    // Safety net — useRealtimeSync invalidates this on ticket.created/updated.
    refetchInterval: 30_000,
  });
}

export function useUpdateTicketStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      ticketsService.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}

export function useReassignTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, assignee }: { id: string; assignee: string }) =>
      ticketsService.reassign(id, assignee),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
