import type { SecurityTestReport } from '../types/domain';
import { apiClient } from './api-client';
import type { BackendSecurityTestReport } from './backend-types';

export const securityTestingService = {
  /** ADMIN-only — runs the real defensive code paths live, see backend SecurityTestingService.runAll. */
  async run(): Promise<SecurityTestReport> {
    const { data } = await apiClient.post<BackendSecurityTestReport>('/security-testing/run');
    return { ...data };
  },
};
