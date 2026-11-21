// Run fn every `ms` while the tab is visible. When the tab is hidden it runs every
// `hiddenMs` instead (or not at all if hiddenMs is 0), and right away when you come back.
// Saves battery, data and API quota. Uses worker timers, so hidden-tab polls stay on time.
import { after } from './ticker.js';
export function everyWhileVisible(fn, ms, hiddenMs = 0) {
  let cancel = null;
  let stopped = false;
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const schedule = () => {
    cancel?.();
    if (stopped) return;
    const wait = hidden() ? hiddenMs : ms;
    if (!wait) return; // paused until the tab is visible again
    cancel = after(wait, async () => {
      try {
        await fn();
      } finally {
        schedule();
      }
    });
  };
  const onVis = () => {
    if (!hidden()) fn();
    schedule();
  };
  fn();
  schedule();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    cancel?.();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
  };
}
