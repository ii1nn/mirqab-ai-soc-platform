import { useMutation } from '@tanstack/react-query';
import { securityTestingService } from '../services/security-testing.service';

/** Requirement #32: on-demand, ADMIN-triggered run — not a query, since each
 * invocation re-runs the live checks rather than reading cached state. */
export function useRunSecurityTests() {
  return useMutation({
    mutationFn: securityTestingService.run,
  });
}
