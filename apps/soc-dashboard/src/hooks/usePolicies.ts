import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { policiesService } from '../services/policies.service';

export function usePolicies() {
  return useQuery({
    queryKey: ['policies'],
    queryFn: policiesService.list,
    // Safety net — useRealtimeSync invalidates this on policy.updated.
    refetchInterval: 30_000,
  });
}

export function useTogglePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => policiesService.toggle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
    },
  });
}
