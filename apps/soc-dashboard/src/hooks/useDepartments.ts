import { useQuery } from '@tanstack/react-query';
import { departmentsService } from '../services/departments.service';

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: departmentsService.list,
    staleTime: 5 * 60_000,
  });
}
