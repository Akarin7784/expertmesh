export {};
declare global {
  interface Window {
    expertmeshDesktop?: {
      chooseDirectory(): Promise<string | null>;
    };
  }
}
