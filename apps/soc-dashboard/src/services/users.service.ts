import type { AuthUser } from './auth.service';
import { apiClient } from './api-client';

/** Backed by the real GET/PATCH /users endpoints added in Phase 4 (Admin-only). */
export const usersService = {
  async list(): Promise<AuthUser[]> {
    const { data } = await apiClient.get<AuthUser[]>('/users');
    return data;
  },

  async setActive(id: string, isActive: boolean): Promise<AuthUser> {
    const { data } = await apiClient.patch<AuthUser>(`/users/${id}/status`, { isActive });
    return data;
  },
};
