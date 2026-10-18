interface DebugSessionNode { id: string; parentSession?: DebugSessionNode }
export interface OwnedCdpAddress { host: string; port: number; path: string }

/** js-debug starts a launcher session before its concrete page adapter exists. */
export async function waitForOwnedCdpProxy<T extends DebugSessionNode>(
  root: T,
  sessions: () => readonly T[],
  request: (session: T) => PromiseLike<unknown>,
  signal: AbortSignal,
  timeoutMs = 15_000,
): Promise<{ session: T; address: OwnedCdpAddress }> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  let triedRoot = false;
  const belongs = (session: DebugSessionNode): boolean => {
    for (let current: DebugSessionNode | undefined = session; current; current = current.parentSession) {
      if (current.id === root.id) {return true;}
    }
    return false;
  };
  while (true) {
    deadline.throwIfAborted();
    for (const session of [root, ...sessions()]) {
      if (!belongs(session) || (session.id === root.id && triedRoot)) {continue;}
      if (session.id === root.id) {triedRoot = true;}
      try {
        const value = await abortable(Promise.resolve(request(session)), AbortSignal.any([deadline, AbortSignal.timeout(3000)]));
        if (value && typeof value === "object" && "host" in value && "port" in value && "path" in value &&
          typeof value.host === "string" && typeof value.port === "number" && typeof value.path === "string") {
          return { session, address: value as OwnedCdpAddress };
        }
      } catch {
        deadline.throwIfAborted();
      }
    }
    await abortable(new Promise<void>((resolve) => {setTimeout(resolve, 100);}), deadline);
  }
}

export function abortable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {signal.removeEventListener("abort", abort); reject(signal.reason);};
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
