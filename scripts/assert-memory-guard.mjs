import { createRequire, syncBuiltinESMExports } from "node:module";
import { inspect } from "node:util";

const require = createRequire(import.meta.url);
const GUARD_MARKER = Symbol.for("deepseek-agent.assert-memory-guard");
const METHODS = ["equal", "notEqual", "strictEqual", "notStrictEqual", "deepEqual",
  "notDeepEqual", "deepStrictEqual", "notDeepStrictEqual", "partialDeepStrictEqual"];

// Compare the ORIGINAL operands. An Error message makes Node throw before its
// unbounded assertion diff is built. Only failed assertions get bounded diagnostics.
export function installAssertMemoryGuard({ target } = {}) {
  if (target === undefined) {
    installAssertMemoryGuard({ target: require("node:assert") });
    installAssertMemoryGuard({ target: require("node:assert/strict") });
    syncBuiltinESMExports();
    return require("node:assert/strict");
  }
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    throw new TypeError("installAssertMemoryGuard requires an assert-like target");
  }
  if (Object.hasOwn(target, GUARD_MARKER)) { return target; }
  for (const name of METHODS) {
    const original = target[name];
    if (typeof original !== "function") { continue; }
    target[name] = function memorySafeAssertion(...args) {
      // Preserve invalid-argument checks and explicitly supplied Error messages.
      if (args.length < 2 || args[2] instanceof Error) {
        return original.apply(this, args);
      }
      const failure = new Error("Assertion comparison failed");
      const message = args[2];
      try {
        return original.call(this, args[0], args[1], failure);
      } catch (error) {
        if (error !== failure) { throw error; }
        const diagnostic = new target.AssertionError({
          actual: summarize(args[0]), expected: summarize(args[1]), operator: name,
          message: message == null ? `${name} comparison failed\nactual: ${summarize(args[0])}\nexpected: ${summarize(args[1])}` : message,
          stackStartFn: memorySafeAssertion,
        });
        diagnostic.showDiff = false;
        throw diagnostic;
      }
    };
  }
  Object.defineProperty(target, GUARD_MARKER, { value: true });
  return target;
}

function summarize(value) {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    // Do not traverse live DOMs, proxies, getters, or custom inspectors.
    return Array.isArray(value) ? "[Array]" : `[${typeof value}]`;
  }
  return inspect(value, { maxStringLength: 1024, customInspect: false });
}
