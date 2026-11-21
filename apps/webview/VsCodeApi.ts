export type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: <T = unknown>() => T | undefined;
  setState: <T = unknown>(state: T) => T;
};

let instance: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi | null {
  if (instance) {return instance;}

  if (typeof window === "undefined") {return null;}

  const acquire = (window as Window & { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi;
  if (typeof acquire !== "function") {return null;}

  instance = acquire();
  return instance;
}
