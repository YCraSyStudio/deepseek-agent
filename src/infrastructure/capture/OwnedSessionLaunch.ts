export interface OwnedSession<T> { session: T; dispose(): Promise<void> }
export async function launchOwnedSession<T>(options: {
  subscribe: (onSession: (session: T) => void) => { dispose(): void };
  launch: () => PromiseLike<boolean>; stop: (session: T) => PromiseLike<void>;
  signal: AbortSignal; timeoutMs?: number;
}): Promise<OwnedSession<T>> {
  options.signal.throwIfAborted();
  let session: T | undefined; let abandoned = false; let launchSettled = false;
  let resolveStart: (value: T) => void; let rejectStart: (error: Error) => void;
  const started = new Promise<T>((resolve, reject) => {resolveStart = resolve; rejectStart = reject;});
  const stopped = new Map<T, Promise<void>>();
  const stop = (value: T) => {
    let pending = stopped.get(value);
    if (!pending) {pending = Promise.resolve(options.stop(value)); stopped.set(value, pending);}
    return pending;
  };
  const subscription = options.subscribe((value) => {
    session = value;
    if (abandoned) {void stop(value).catch(() => undefined);}
    else {resolveStart(value);}
  });
  const abort = () => rejectStart(new Error("Owned browser session launch cancelled"));
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) {abort();}
  const timer = setTimeout(() => rejectStart(new Error("Owned browser session launch timed out")), options.timeoutMs ?? 8000);
  void started.catch(() => undefined);
  let launch: Promise<boolean>;
  try {launch = Promise.resolve(options.launch());}
  catch (error) {launch = Promise.reject(error);}
  const launched = launch.then((ok) => {
    launchSettled = true;
    if (abandoned) {subscription.dispose();}
    if (!ok) {throw new Error("VS Code rejected the owned browser launch");}
    return started;
  }, (error) => {launchSettled = true; if (abandoned) {subscription.dispose();} throw error;});
  try {
    const owned = await Promise.race([started, launched]);
    options.signal.throwIfAborted();
    return { session: owned, async dispose() {abandoned = true; subscription.dispose(); await stop(owned);} };
  } catch (error) {
    abandoned = true;
    if (launchSettled) {subscription.dispose();}
    if (session !== undefined) {await stop(session).catch(() => undefined);}
    throw error;
  } finally {
    clearTimeout(timer); options.signal.removeEventListener("abort", abort);
  }
}
