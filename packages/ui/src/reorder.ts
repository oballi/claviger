/** New full order after dropping `dragged` onto `target`; null when they are in different groups or the same row. */
export function reorderByDrop(
  accounts: readonly { id: string; pinned: boolean; groupId?: string | null }[],
  dragged: string,
  target: string,
): string[] | null {
  const from = accounts.findIndex((a) => a.id === dragged);
  const to = accounts.findIndex((a) => a.id === target);
  if (from < 0 || to < 0 || from === to) return null;
  if (
    accounts[from]!.pinned !== accounts[to]!.pinned ||
    (accounts[from]!.groupId ?? null) !== (accounts[to]!.groupId ?? null)
  )
    return null;
  const order = accounts.map((a) => a.id);
  order.splice(from, 1);
  // After removal the target shifted left when it was below the dragged row.
  const index = order.indexOf(target);
  order.splice(from < to ? index + 1 : index, 0, dragged);
  return order;
}

/** The row `delta` places away among the rows that share `id`'s pinned state and group (pinned and other rows never swap). */
export function neighbourOf<T extends { id: string; pinned: boolean; groupId?: string | null }>(
  rows: readonly T[],
  id: string,
  delta: -1 | 1,
): T | undefined {
  const me = rows.find((r) => r.id === id);
  if (!me) return undefined;
  const same = rows.filter(
    (r) => r.pinned === me.pinned && (r.groupId ?? null) === (me.groupId ?? null),
  );
  return same[same.findIndex((r) => r.id === id) + delta];
}

export function swapOrder(order: readonly string[], a: string, b: string): string[] {
  const next = [...order];
  const i = next.indexOf(a);
  const j = next.indexOf(b);
  if (i < 0 || j < 0) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
