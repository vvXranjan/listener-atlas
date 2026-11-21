import React, { useEffect, useState } from 'react';
import { flag } from './countries.js';

// City search with suggestions (offline city list on the dev server)
export default function CitySearch({ onPick, loading }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return setList([]);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q.trim())}`);
        setList(res.ok ? await res.json() : []);
      } catch {
        setList([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  function pick(c) {
    setQ(c.name);
    setOpen(false);
    onPick(c);
  }

  return (
    <form
      className="city-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (list[0]) pick(list[0]);
        else if (q.trim()) pick({ name: q.trim() });
      }}
    >
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search a city… e.g. Atlanta"
      />
      <button disabled={loading}>{loading ? '…' : 'Go'}</button>
      {open && list.length > 0 && (
        <div className="suggest">
          {list.map((c) => (
            <button type="button" key={`${c.name}|${c.country}`} onMouseDown={() => pick(c)}>
              <span>{flag(c.country)}</span>
              <span className="an">{c.name}</span>
              <span className="muted">{c.countryName}</span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
