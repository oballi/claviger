/** New full order after dropping `dragged` onto `target`; null when they are in different groups or the same row. */
export function reorderByDrop(
  accounts: readonly { id: string; pinned: boolean }[],
  dragged: string,
  target: string,
): string[] | null {
  const from = accounts.findIndex((a) => a.id === dragged);
  const to = accounts.findIndex((a) => a.id === target);
  if (from < 0 || to < 0 || from === to) return null;
  if (accounts[from]!.pinned !== accounts[to]!.pinned) return null;
  const order = accounts.map((a) => a.id);
  order.splice(from, 1);
  // After removal the target shifted left when it was below the dragged row.
  const index = order.indexOf(target);
  order.splice(from < to ? index + 1 : index, 0, dragged);
  return order;
}
