import type { Department } from '../types/domain';
import { apiClient } from './api-client';
import type { BackendDepartment } from './backend-types';

function adapt(department: BackendDepartment): Department {
  return { id: department.id, name: department.name };
}

export const departmentsService = {
  async list(): Promise<Department[]> {
    const { data } = await apiClient.get<BackendDepartment[]>('/departments');
    return data.map(adapt);
  },
};
