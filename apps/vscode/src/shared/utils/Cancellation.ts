export function createAbortError(message = "Operation cancelled"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal, message?: string): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

export function isCancellationError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "Canceled"));
}
