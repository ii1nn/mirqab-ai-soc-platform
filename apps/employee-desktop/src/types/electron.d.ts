import type { MirqabApi } from '../../electron/preload';

declare global {
  interface Window {
    mirqab: MirqabApi;
  }
}

export {};
