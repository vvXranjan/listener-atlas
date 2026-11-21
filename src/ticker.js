// Timers that keep running on time when the tab is in the background.
// Browsers slow down normal timers in hidden tabs (Chrome: down to once a minute),
// which made Auto-DJ miss the end of songs. Timers inside a Web Worker aren't slowed.

let worker = null;
let nextId = 0;
const waiting = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') throw new Error();
    const code = `const t = new Map();
onmessage = (e) => {
  const { id, ms, cancel } = e.data;
  if (cancel) { clearTimeout(t.get(id)); t.delete(id); return; }
  t.set(id, setTimeout(() => { t.delete(id); postMessage(id); }, ms));
};`;
    worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      const fn = waiting.get(e.data);
      waiting.delete(e.data);
      fn?.();
    };
    worker.onerror = () => {
      worker = false; // fall back to normal timers
    };
  } catch {
    worker = false;
  }
  return worker;
}

// setTimeout that isn't slowed down in background tabs. Returns a cancel function.
export function after(ms, fn) {
  const w = getWorker();
  if (!w) {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }
  const id = ++nextId;
  waiting.set(id, fn);
  w.postMessage({ id, ms });
  return () => {
    waiting.delete(id);
    w.postMessage({ id, cancel: true });
  };
}

export const sleep = (ms) => new Promise((r) => after(ms, r));
