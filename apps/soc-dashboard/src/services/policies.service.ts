import type { PolicyRecord } from '../types/domain';
import { apiClient } from './api-client';
import type { BackendPolicy } from './backend-types';

function adapt(policy: BackendPolicy): PolicyRecord {
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    category: policy.category,
    enabled: policy.enabled,
    compliancePercent: policy.compliancePercent,
    updatedAt: policy.updatedAt,
  };
}

export const policiesService = {
  async list(): Promise<PolicyRecord[]> {
    const { data } = await apiClient.get<BackendPolicy[]>('/policies');
    return data.map(adapt);
  },

  async toggle(id: string): Promise<PolicyRecord> {
    const { data } = await apiClient.patch<BackendPolicy>(`/policies/${id}/toggle`);
    return adapt(data);
  },
};
