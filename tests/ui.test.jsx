import { it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
globalThis.localStorage = { getItem: (k) => (k === 'mixlab-set-v1' ? JSON.stringify([{ title: 'BIG 5', artist: 'Key Glock' }, { title: 'SICKO MODE', artist: 'Travis Scott' }]) : null), setItem() {} };
globalThis.window = globalThis;
globalThis.Audio = class { addEventListener() {} };
it('renders Mix Lab and the set panel', async () => {
  const { default: SetPanel } = await import('../src/SetPanel.jsx');
  const { default: MixLab } = await import('../src/MixLab.jsx');
  const a = renderToString(<SetPanel start={{ title: 'Crodie', artist: 'Tory Lanez', now: true }} floating onLibrary={() => {}} />);
  expect(a).toContain('SICKO MODE');
  expect(a).toContain('Set flow');
  const b = renderToString(<MixLab track={{ id: '1', name: 'Crodie', artists: [{ name: 'Tory Lanez' }] }} onClose={() => {}} onArtist={() => {}} onFloat={() => {}} />);
  expect(b).toContain('Your set');
  expect(b).toContain('Float');
  const { default: MiniPlayer } = await import('../src/MiniPlayer.jsx');
  expect(renderToString(<MiniPlayer />)).toContain('Connect Spotify');
  // Your patterns tab, with a few learned plays
  const { mergePlays, emptyDoc } = await import('../src/habitsCore.js');
  const t = Date.now() - 3600e3;
  localStorage.getItem = (k) =>
    k === 'listener-habits-v1'
      ? JSON.stringify(mergePlays(emptyDoc(), [{ title: 'HIGHEST IN THE ROOM', artist: 'Travis Scott', playedAt: t }, { title: 'No Pole', artist: 'Don Toliver', playedAt: t + 180e3 }]))
      : null;
  vi.resetModules();
  const { Patterns } = await import('../src/Library.jsx');
  const pt = renderToString(<Patterns filter="" onMixLab={() => {}} />);
  expect(pt).toContain('What you play next');
  expect(pt).toContain('No Pole');
  const c = renderToString(<MixLab track={null} floatingSet onDock={() => {}} onClose={() => {}} onArtist={() => {}} />);
  expect(c).toContain('floating window');
});
