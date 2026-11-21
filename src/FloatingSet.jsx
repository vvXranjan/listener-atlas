import React from 'react';
import FloatWindow from './FloatWindow.jsx';
import MiniPlayer from './MiniPlayer.jsx';
import SetPanel from './SetPanel.jsx';

// "Your set" in its own window, with a mini player on top
export default function FloatingSet({ start, onClose, onDock, onLibrary }) {
  return (
    <FloatWindow title="Your set" storageKey="floatSetBox" head={<MiniPlayer />} onClose={onClose} onDock={onDock}>
      <SetPanel start={start} floating onLibrary={onLibrary} />
    </FloatWindow>
  );
}
