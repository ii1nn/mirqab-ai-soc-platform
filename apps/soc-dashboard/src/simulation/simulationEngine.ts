import { isAxiosError } from 'axios';
import { create } from 'zustand';
import { incidentsService } from '../services/incidents.service';
import type { VirtualDevice } from '../types/domain';
import { buildLogExcerpt, randomScenario } from './scenarios';

const TICK_INTERVAL_MS = 8000;

interface SimulationState {
  isRunning: boolean;
  lastError: string | null;
  start: (devices: VirtualDevice[]) => void;
  stop: () => void;
}

/** setInterval handle lives outside store state — it's engine plumbing, not serializable UI state. */
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function randomDevice(devices: VirtualDevice[]): VirtualDevice {
  return devices[Math.floor(Math.random() * devices.length)];
}

/**
 * Per the platform spec's Simulation Mode requirement (5 departments,
 * virtual devices, attack scenarios, real-time updates) — but rather than
 * synthesizing alerts/incidents/tickets in a client-side store (Phase 4),
 * this posts a realistic log excerpt through the REAL `POST /ai/analyze`
 * pipeline every tick. Every Incident/Ticket/Notification it produces is
 * genuinely persisted in Postgres and classified by the real AI engine
 * (Claude, or its rule-based fallback) — this store holds no incident data
 * of its own, only the timer. The dashboard's polling queries pick up the
 * new rows on their own; no manual cache invalidation needed here.
 */
/** A tick that fails silently is the whole bug this store exists to avoid
 * repeating — every failure (including a 429 from the backend's own
 * per-IP throttle on /ai/analyze) lands in `lastError` so the UI has
 * something real to show instead of a toggle that keeps claiming success. */
function runTick(devices: VirtualDevice[], set: (state: Partial<SimulationState>) => void): void {
  const device = randomDevice(devices);
  const scenario = randomScenario();
  const sourceExcerpt = buildLogExcerpt(scenario, device);

  incidentsService
    .analyze({ sourceExcerpt, deviceId: device.id, source: 'SIMULATION' })
    .then(() => set({ lastError: null }))
    .catch((error) => {
      const message =
        isAxiosError(error) && error.response?.status === 429
          ? 'Rate limited by the backend — retrying automatically.'
          : error instanceof Error
            ? error.message
            : 'Simulation request failed';
      set({ lastError: message });
    });
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  isRunning: false,
  lastError: null,

  start(devices) {
    if (get().isRunning || devices.length === 0) return;
    set({ isRunning: true, lastError: null });

    // Fires once right away (instead of only after the first 8s interval
    // tick) — same request, same store, no UI change needed for this.
    runTick(devices, set);
    intervalHandle = setInterval(() => runTick(devices, set), TICK_INTERVAL_MS);
  },

  stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    set({ isRunning: false });
  },
}));
