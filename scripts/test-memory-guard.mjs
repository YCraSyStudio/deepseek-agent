const MIB = 1024 * 1024;

export function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssMb: toMegabytes(usage.rss),
    heapUsedMb: toMegabytes(usage.heapUsed),
    heapTotalMb: toMegabytes(usage.heapTotal),
    externalMb: toMegabytes(usage.external),
    arrayBuffersMb: toMegabytes(usage.arrayBuffers),
  };
}

export function formatSnapshot(snapshot) {
  return `rss=${snapshot.rssMb}MiB heap=${snapshot.heapUsedMb}/${snapshot.heapTotalMb}MiB external=${snapshot.externalMb}MiB arrayBuffers=${snapshot.arrayBuffersMb}MiB`;
}

export function createMemoryGuard({
  limitMb,
  intervalMs = 250,
  currentLabel = () => "",
  sample = memorySnapshot,
  log = (message) => console.error(message),
  onExceeded = () => undefined,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!(limitMb > 0)) {
    throw new Error("createMemoryGuard requires a positive limitMb");
  }
  let timer;
  let peak = sample();
  let latest = peak;
  let breached = false;

  function observe() {
    latest = sample();
    peak = {
      rssMb: Math.max(peak.rssMb, latest.rssMb),
      heapUsedMb: Math.max(peak.heapUsedMb, latest.heapUsedMb),
      heapTotalMb: Math.max(peak.heapTotalMb, latest.heapTotalMb),
      externalMb: Math.max(peak.externalMb, latest.externalMb),
      arrayBuffersMb: Math.max(peak.arrayBuffersMb, latest.arrayBuffersMb),
    };
    return latest;
  }

  function check() {
    const observed = observe();
    if (!breached && observed.rssMb >= limitMb) {
      breached = true;
      stop();
      const label = currentLabel();
      log(`Memory limit exceeded (${observed.rssMb}MiB >= ${limitMb}MiB) while running: ${label || "<unknown>"}`);
      onExceeded({ ...observed, limitMb, label });
    }
    return observed;
  }

  function start() {
    if (timer !== undefined) { return; }
    timer = setIntervalFn(check, intervalMs);
    timer?.unref?.();
  }

  function stop() {
    if (timer === undefined) { return; }
    clearIntervalFn(timer);
    timer = undefined;
  }

  return {
    start,
    stop,
    check,
    get breached() { return breached; },
    get latest() { return latest; },
    get peak() { return peak; },
  };
}

function toMegabytes(bytes) {
  return Math.round((bytes / MIB) * 10) / 10;
}
