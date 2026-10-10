import type { TicketRecord, TicketStatus } from '../types/domain';
import { fromBackendSeverity, fromBackendTicketStatus, toBackendTicketStatus } from './adapters';
import { apiClient } from './api-client';
import type { BackendTicket } from './backend-types';

function adapt(ticket: BackendTicket): TicketRecord {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    incidentId: ticket.incidentId,
    title: ticket.title,
    status: fromBackendTicketStatus(ticket.status),
    severity: fromBackendSeverity(ticket.severity),
    assignee: ticket.assignee,
    departmentId: ticket.departmentId,
    deviceId: ticket.deviceId,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

export const ticketsService = {
  async list(): Promise<TicketRecord[]> {
    const { data } = await apiClient.get<BackendTicket[]>('/tickets');
    return data.map(adapt);
  },

  async updateStatus(id: string, status: TicketStatus): Promise<TicketRecord> {
    const { data } = await apiClient.patch<BackendTicket>(`/tickets/${id}/status`, {
      status: toBackendTicketStatus(status),
    });
    return adapt(data);
  },

  async reassign(id: string, assignee: string): Promise<TicketRecord> {
    const { data } = await apiClient.patch<BackendTicket>(`/tickets/${id}/assignee`, { assignee });
    return adapt(data);
  },
};
