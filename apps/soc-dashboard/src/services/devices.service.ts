import type { VirtualDevice } from '../types/domain';
import { apiClient } from './api-client';
import { fromBackendDeviceStatus } from './adapters';
import type { BackendDevice } from './backend-types';

function adapt(device: BackendDevice): VirtualDevice {
  return {
    id: device.id,
    hostname: device.hostname,
    departmentId: device.departmentId,
    os: device.os,
    deviceType: device.deviceType,
    ipAddress: device.ipAddress,
    baselineScore: device.baselineScore,
    status: fromBackendDeviceStatus(device.status),
    currentScore: device.currentScore,
    activeIncidentCount: device.activeIncidentCount,
    isolated: device.isolated,
    isolatedAt: device.isolatedAt,
    isolatedBy: device.isolatedBy,
  };
}

export const devicesService = {
  async list(departmentId?: string): Promise<VirtualDevice[]> {
    const { data } = await apiClient.get<BackendDevice[]>('/devices', {
      params: departmentId ? { departmentId } : undefined,
    });
    return data.map(adapt);
  },

  async get(id: string): Promise<VirtualDevice> {
    const { data } = await apiClient.get<BackendDevice>(`/devices/${id}`);
    return adapt(data);
  },
};
