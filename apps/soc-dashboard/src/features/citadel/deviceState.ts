import type { VirtualDevice } from '../../types/domain';

export type DeviceVisualState = 'isolated' | 'critical' | 'warning' | 'online';

/**
 * Every state here is derived from real Device fields already computed
 * server-side (DevicesService.withComputedStatus) — isolated, status,
 * currentScore. There is no "offline" or "compromised" state: MIRQAB's
 * Device model has no heartbeat/last-seen signal to honestly back an
 * "offline" reading, and no field distinct from "at-risk" to honestly back
 * a separate "compromised" reading — showing either would be inventing
 * data the backend doesn't have. The score thresholds mirror the exact
 * convention CitadelLiveViewPage's own org-score tile already uses
 * (>=80 healthy, >=50 warning, below that danger).
 */
export function deriveDeviceState(device: VirtualDevice): DeviceVisualState {
  if (device.isolated) return 'isolated';
  if (device.status === 'at-risk') {
    return device.currentScore < 50 ? 'critical' : 'warning';
  }
  return 'online';
}

export const DEVICE_STATE_LABEL: Record<DeviceVisualState, string> = {
  isolated: 'Isolated',
  critical: 'Critical',
  warning: 'Warning',
  online: 'Online',
};

/** Matching apps/soc-dashboard/src/components/ui/Badge.tsx's SecurityStatus tones. */
export const DEVICE_STATE_BADGE_STATUS: Record<
  DeviceVisualState,
  'success' | 'warning' | 'danger' | 'unknown'
> = {
  isolated: 'unknown',
  critical: 'danger',
  warning: 'warning',
  online: 'success',
};

export const DEVICE_STATE_DOT_CLASS: Record<DeviceVisualState, string> = {
  isolated: 'bg-slate-400',
  critical: 'bg-mirqab-danger shadow-glow-red',
  warning: 'bg-mirqab-warning shadow-glow-orange',
  online: 'bg-mirqab-success shadow-glow-green',
};
