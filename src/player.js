import { useEffect, useState } from 'react';

// One shared audio element for 30-second previews
const audio = typeof Audio !== 'undefined' ? new Audio() : null;
let current = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(current));

if (audio) {
  audio.volume = 0.8;
  audio.addEventListener('ended', () => {
    current = null;
    emit();
  });
}

export function togglePreview(url) {
  if (!audio || !url) return;
  if (current === url) {
    audio.pause();
    current = null;
  } else {
    audio.src = url;
    audio.play().catch(() => {});
    current = url;
  }
  emit();
}

export function usePlaying() {
  const [playing, setPlaying] = useState(current);
  useEffect(() => {
    listeners.add(setPlaying);
    return () => listeners.delete(setPlaying);
  }, []);
  return playing;
}
