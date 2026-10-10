import { useQuery } from '@tanstack/react-query';
import { deviceService } from '../services/device.service';

export function useProcesses() {
  return useQuery({
    queryKey: ['device', 'processes'],
    queryFn: deviceService.getProcesses,
    refetchInterval: 10_000,
  });
}
