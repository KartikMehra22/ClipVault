import type { DesktopBridge } from '@cliporbit/contracts';

declare global {
  interface Window {
    clipOrbit: DesktopBridge;
    clipVault?: DesktopBridge;
  }
}

export {};
