// fetch with a time limit, so one slow outside service can't hang a request.
// Uses the global fetch at call time (tests can still stub it).
export const TIMEOUT_MS = 9000;

export function fetchT(url, opts = {}) {
  if (opts.signal || typeof AbortSignal?.timeout !== 'function') return globalThis.fetch(url, opts);
  return globalThis.fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs || TIMEOUT_MS) });
}
