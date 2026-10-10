import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersService } from '../services/users.service';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: usersService.list,
  });
}

export function useSetUserActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersService.setActive(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
