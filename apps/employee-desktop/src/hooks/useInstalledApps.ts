import { useQuery } from '@tanstack/react-query';
import { deviceService } from '../services/device.service';

export function useInstalledApps() {
  return useQuery({
    queryKey: ['device', 'installed-apps'],
    queryFn: deviceService.getInstalledApps,
    staleTime: 5 * 60 * 1000,
  });
}
