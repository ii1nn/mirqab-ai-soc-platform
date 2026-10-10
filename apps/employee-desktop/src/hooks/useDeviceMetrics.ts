import { useQuery } from '@tanstack/react-query';
import { deviceService } from '../services/device.service';

export function useDeviceMetrics() {
  return useQuery({
    queryKey: ['device', 'metrics'],
    queryFn: deviceService.getMetrics,
    refetchInterval: 5000,
  });
}
