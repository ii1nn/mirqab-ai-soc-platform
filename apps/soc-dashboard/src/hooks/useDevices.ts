import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { buildLogExcerpt, randomScenario } from '../simulation/scenarios';
import { incidentsService } from '../services/incidents.service';
import { devicesService } from '../services/devices.service';
import type { VirtualDevice } from '../types/domain';

export function useDevices(departmentId?: string) {
  return useQuery({
    queryKey: ['devices', departmentId ?? 'all'],
    queryFn: () => devicesService.list(departmentId),
    // Safety net — useRealtimeSync invalidates this whenever an incident
    // event fires, since device status/score derive from open incidents.
    refetchInterval: 30_000,
  });
}

/**
 * A single, immediate, deterministically-targeted attack against one
 * device — the on-demand counterpart to Simulation Mode's continuous
 * random-device timer (see simulation/simulationEngine.ts). Reuses the
 * exact same real `/ai/analyze` pipeline and scenario text builders, just
 * triggered once against a chosen device instead of a random one every 8s,
 * so an analyst can reliably observe the full attack → countdown →
 * isolate flow for a specific endpoint instead of waiting on chance.
 */
export function useSimulateAttack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (device: VirtualDevice) => {
      const scenario = randomScenario();
      const sourceExcerpt = buildLogExcerpt(scenario, device);
      return incidentsService.analyze({ sourceExcerpt, deviceId: device.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
}
