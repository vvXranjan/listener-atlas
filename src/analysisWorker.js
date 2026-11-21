// Runs the tempo / key / sound math off the main thread
import { analyzeSamples } from './audioAnalysis.js';

self.onmessage = (e) => {
  const { id, samples, sampleRate } = e.data;
  try {
    self.postMessage({ id, result: analyzeSamples(samples, sampleRate) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
