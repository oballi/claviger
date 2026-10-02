export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** New order after dropping `dragged` onto `target`; same rule as the account table. */
export function dropId(ids: readonly string[], dragged: string, target: string): string[] | null {
  const from = ids.indexOf(dragged);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  const next = ids.filter((id) => id !== dragged);
  const at = next.indexOf(target);
  next.splice(from < to ? at + 1 : at, 0, dragged);
  return next;
}
