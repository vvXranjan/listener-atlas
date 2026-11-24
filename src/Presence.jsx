import { useEffect, useRef, useState } from 'react';

// Keeps a panel on screen for a moment after it closes, so it can fade/slide away
// instead of vanishing in one frame.
export default function Presence({ show, ms = 220, children }) {
  const [mounted, setMounted] = useState(!!show);
  const [leaving, setLeaving] = useState(false);
  const last = useRef(children);
  if (show) last.current = children;

  useEffect(() => {
    if (show) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(t);
  }, [show]);

  if (!show && !mounted) return null;
  return <div className={`presence ${leaving ? 'leaving' : ''}`}>{show ? children : last.current}</div>;
}
