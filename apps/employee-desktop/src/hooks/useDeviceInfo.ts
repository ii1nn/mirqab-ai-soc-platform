import { useQuery } from '@tanstack/react-query';
import { deviceService } from '../services/device.service';

export function useDeviceInfo() {
  return useQuery({
    queryKey: ['device', 'info'],
    queryFn: deviceService.getInfo,
    staleTime: Infinity,
  });
}
