// Move one item to a new place in a list (new list; same list if nothing changes)
export function reorder(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const n = [...list];
  const [x] = n.splice(from, 1);
  n.splice(to, 0, x);
  return n;
}

// While dragging: where would the song land? rows = [{ i, mid }] (screen middle of each row)
export const dropIndex = (rows, from, y) => rows.filter((r) => r.i !== from && r.mid < y).length;
