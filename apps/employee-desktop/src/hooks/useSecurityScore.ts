import { useMemo } from 'react';
import { computeSecurityScore } from '../features/security-score/scoreEngine';
import { useDeviceMetrics } from './useDeviceMetrics';

export function useSecurityScore() {
  const { data: metrics, isLoading, isError } = useDeviceMetrics();

  const result = useMemo(() => (metrics ? computeSecurityScore(metrics) : null), [metrics]);

  return { result, isLoading, isError };
}
