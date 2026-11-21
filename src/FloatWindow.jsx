import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A window you control: drag it anywhere (it snaps to corners and edges when you
// let go close to them), resize it from any edge or corner, minimise it.
// It always stays fully on screen. Pointer events + transforms = smooth in Safari and Chrome.
const MIN_W = 320;
const MIN_H = 200;
const GAP = 12; // space kept from the screen edge
const SNAP = 48; // let go this close to an edge and it snaps

const vw = () => window.innerWidth;
const vh = () => window.innerHeight;

function loadBox(key) {
  try {
    const b = JSON.parse(localStorage.getItem(key) || 'null');
    if (b && b.w) return { x: b.x, y: b.y, w: b.w, h: Math.min(b.h, Math.round(vh() * 0.85)), min: !!b.min };
  } catch {}
  const w = Math.min(440, vw() - GAP * 2);
  return { x: vw() - w - GAP, y: 80, w, h: Math.min(520, Math.round(vh() * 0.62)), min: false };
}

// keep the whole window on screen
export function clampBox(b, W = vw(), H = vh(), minimised = b.min) {
  const w = Math.round(Math.max(MIN_W, Math.min(b.w, W - GAP * 2)));
  const h = Math.round(Math.max(MIN_H, Math.min(b.h, H - GAP * 2)));
  const shownH = minimised ? 48 : h;
  return {
    ...b,
    w,
    h,
    x: Math.round(Math.max(GAP, Math.min(b.x, W - w - GAP))),
    y: Math.round(Math.max(GAP, Math.min(b.y, H - shownH - GAP))),
  };
}

// let go near an edge: stick to it
export function snapBox(b, W = vw(), H = vh(), shownH = b.h) {
  const out = { ...b };
  if (b.x - GAP < SNAP) out.x = GAP;
  else if (W - (b.x + b.w) - GAP < SNAP) out.x = W - b.w - GAP;
  if (b.y - GAP < SNAP) out.y = GAP;
  else if (H - (b.y + shownH) - GAP < SNAP) out.y = H - shownH - GAP;
  return out;
}

const CORNERS = {
  tl: (b) => ({ ...b, x: GAP, y: GAP }),
  tr: (b) => ({ ...b, x: vw() - b.w - GAP, y: GAP }),
  bl: (b) => ({ ...b, x: GAP, y: vh() - (b.min ? 48 : b.h) - GAP }),
  br: (b) => ({ ...b, x: vw() - b.w - GAP, y: vh() - (b.min ? 48 : b.h) - GAP }),
};
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export default function FloatWindow({ title, storageKey, onClose, onDock, extra, head, children }) {
  const [box, setBox] = useState(() => clampBox(loadBox(storageKey)));
  const [guide, setGuide] = useState(null); // where it will snap, shown while dragging
  const [moving, setMoving] = useState(false);
  const el = useRef(null);
  const live = useRef(box);
  live.current = box;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(box));
    } catch {}
  }, [box, storageKey]);
  useEffect(() => {
    const onResize = () => setBox((b) => clampBox(b));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function paint(b) {
    const n = el.current;
    if (!n) return;
    n.style.transform = `translate3d(${b.x}px, ${b.y}px, 0)`;
    n.style.width = `${b.w}px`;
    if (!b.min) n.style.height = `${b.h}px`;
  }

  // drag (mode 'move') or resize (mode = an edge like 'se')
  function startGesture(e, mode) {
    if (e.button !== undefined && e.button !== 0) return;
    if (mode === 'move' && e.target.closest('button, input, a, label, select, [role="slider"]')) return;
    e.preventDefault();
    e.stopPropagation();
    const s = { px: e.clientX, py: e.clientY, ...live.current };
    const shownH = s.min ? el.current?.offsetHeight || 48 : s.h;
    let next = s;
    let raf = 0;
    setMoving(true);
    document.body.classList.add('fw-dragging');
    document.body.style.cursor = mode === 'move' ? 'grabbing' : getComputedStyle(e.currentTarget).cursor;

    const onMove = (ev) => {
      const dx = ev.clientX - s.px;
      const dy = ev.clientY - s.py;
      const b = { ...s };
      if (mode === 'move') {
        b.x = s.x + dx;
        b.y = s.y + dy;
      } else {
        if (mode.includes('e')) b.w = s.w + dx;
        if (mode.includes('s')) b.h = s.h + dy;
        if (mode.includes('w')) {
          b.w = Math.max(MIN_W, s.w - dx);
          b.x = s.x + (s.w - b.w);
        }
        if (mode.includes('n')) {
          b.h = Math.max(MIN_H, s.h - dy);
          b.y = s.y + (s.h - b.h);
        }
      }
      next = clampBox(b, vw(), vh(), s.min);
      const snapped = mode === 'move' ? snapBox(next, vw(), vh(), shownH) : next;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        paint(next);
        setGuide(mode === 'move' && (snapped.x !== next.x || snapped.y !== next.y) ? { ...snapped, h: shownH } : null);
      });
    };
    const onUp = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      document.body.classList.remove('fw-dragging');
      document.body.style.cursor = '';
      setMoving(false);
      setGuide(null);
      const final = mode === 'move' ? snapBox(next, vw(), vh(), shownH) : next;
      paint(final);
      setBox({ x: final.x, y: final.y, w: final.w, h: final.h, min: live.current.min });
    };
    // listen on the whole window, so fast moves never "drop" the window
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  }

  const toCorner = (c) => setBox((b) => clampBox(CORNERS[c](b)));
  const toggleMin = () => setBox((b) => clampBox({ ...b, min: !b.min }));

  return createPortal(
    <>
      {guide && <div className="fw-guide" style={{ transform: `translate3d(${guide.x}px, ${guide.y}px, 0)`, width: guide.w, height: guide.h }} />}
      <div
        ref={el}
        className={`fw ${box.min ? 'min' : ''} ${moving ? 'moving' : ''}`}
        style={{ transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width: box.w, height: box.min ? 'auto' : box.h }}
      >
        <div className="fw-head" onPointerDown={(e) => startGesture(e, 'move')}>
          <div className="fw-bar" title="Drag to move · double-click to minimise" onDoubleClick={toggleMin}>
            <span className="fw-grip">⋮⋮</span>
            <span className="fw-title">{title}</span>
            {extra}
            <span className="fw-corners">
              {[
                ['tl', '◰', 'top-left'],
                ['tr', '◳', 'top-right'],
                ['bl', '◱', 'bottom-left'],
                ['br', '◲', 'bottom-right'],
              ].map(([c, icon, label]) => (
                <button key={c} onClick={() => toCorner(c)} title={`Move to ${label}`} aria-label={`Move to ${label}`}>
                  {icon}
                </button>
              ))}
            </span>
            <button onClick={toggleMin} title={box.min ? 'Expand' : 'Minimise'} aria-label="Minimise">
              {box.min ? '▢' : '–'}
            </button>
            {onDock && (
              <button onClick={onDock} title="Put back into Mix Lab" aria-label="Dock">
                ⇲
              </button>
            )}
            <button onClick={onClose} title="Close" aria-label="Close">
              ×
            </button>
          </div>
          {head}
        </div>
        {!box.min && <div className="fw-body">{children}</div>}
        {!box.min && EDGES.map((d) => <div key={d} className={`fw-edge fw-${d}`} onPointerDown={(e) => startGesture(e, d)} />)}
      </div>
    </>,
    document.body
  );
}
