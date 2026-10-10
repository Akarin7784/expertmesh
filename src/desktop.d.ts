import type { DesktopWindowState } from '../shared/desktop';
declare global {
  interface Window {
    expertmeshDesktop?: {
      chooseDirectory(): Promise<string | null>;
      minimize(): Promise<void>;
      toggleMaximize(): Promise<void>;
      close(): Promise<void>;
      getWindowState(): Promise<DesktopWindowState>;
      onWindowState(listener: (state: DesktopWindowState) => void): () => void;
    };
  }
}
