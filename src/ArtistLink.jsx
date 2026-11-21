// Any artist name on screen: click it to open that artist's Galaxy.
// "A, B & C feat. D" becomes four separate links.

export function openGalaxy(name) {
  const n = String(name || '').trim();
  if (n) window.dispatchEvent(new CustomEvent('open-galaxy', { detail: n }));
}

const SEP = /(,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|with)\s+)/i;

// split into [{ text, link }] keeping the separators as plain text
export function artistParts(name) {
  const bits = String(name || '').split(SEP);
  const out = [];
  for (let i = 0; i < bits.length; i++) {
    const t = bits[i];
    if (!t) continue;
    if (i % 2 === 1) {
      // keep names like "Tyler, The Creator" whole
      const next = bits[i + 1] || '';
      if (/^,/.test(t) && /^the\s/i.test(next) && out.length && !out[out.length - 1].sep) {
        out[out.length - 1].text += t + next;
        i++;
        continue;
      }
      out.push({ text: t, sep: true });
    } else out.push({ text: t, sep: false });
  }
  return out;
}

export default function ArtistLink({ name }) {
  if (!name) return null;
  return artistParts(name).map((p, i) =>
    p.sep ? (
      <span key={i}>{p.text}</span>
    ) : (
      <span
        key={i}
        className="artist-link"
        role="link"
        tabIndex={0}
        title={`Open ${p.text.trim()}'s Galaxy`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          openGalaxy(p.text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            openGalaxy(p.text);
          }
        }}
      >
        {p.text}
      </span>
    )
  );
}
