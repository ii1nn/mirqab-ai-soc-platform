import type { DeviceMetrics, ProcessInfo } from '../../electron/ipc/device.ipc';
import type { ScanFinding, ScanResult } from '../types/domain';
import { apiClient } from './api-client';

/**
 * MOCK THREAT INTEL — a tiny illustrative watchlist standing in for the
 * backend's FAISS similarity engine + Claude classification (not built yet,
 * see docs/phases). Matching is a cosmetic substring check, not real
 * malware detection.
 */
const MOCK_SUSPICIOUS_PROCESS_NAMES = ['coinminer', 'keylogger-demo', 'ransimware-sample'];

async function runBackendScan(payload: unknown): Promise<ScanResult | null> {
  try {
    const { data } = await apiClient.post<ScanResult>('/ai/scan', payload);
    return data;
  } catch {
    // Expected until the backend AI module exists — fall back locally.
    return null;
  }
}

function runLocalHeuristicScan(processes: ProcessInfo[]): ScanResult {
  const findings: ScanFinding[] = processes
    .filter((proc) =>
      MOCK_SUSPICIOUS_PROCESS_NAMES.some((name) => proc.name.toLowerCase().includes(name)),
    )
    .map((proc) => ({
      id: `proc-${proc.pid}`,
      label: `Suspicious process name: ${proc.name}`,
      severity: 'high',
      isMock: true,
      detail: 'Matched against a local sample watchlist — not a verified threat signature.',
    }));

  return {
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    findings,
    source: 'local-heuristic',
  };
}

export async function runAiScan(
  metrics: DeviceMetrics,
  processes: ProcessInfo[],
): Promise<ScanResult> {
  const startedAt = new Date().toISOString();
  const backendResult = await runBackendScan({ metrics, processes, startedAt });
  return backendResult ?? runLocalHeuristicScan(processes);
}
