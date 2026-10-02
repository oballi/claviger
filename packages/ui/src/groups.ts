import type { GroupView } from "./contract/views";

export interface Section<T> {
  group: GroupView | null;
  rows: T[];
}

export const NO_GROUP_KEY = "none";

export function sectionsOf<T extends { groupId: string | null; pinned: boolean }>(
  rows: readonly T[],
  groups: readonly GroupView[],
): Section<T>[] {
  const known = new Set(groups.map((g) => g.id));
  const pinnedFirst = (list: T[]) => [
    ...list.filter((r) => r.pinned),
    ...list.filter((r) => !r.pinned),
  ];
  const out: Section<T>[] = groups.map((group) => ({
    group,
    rows: pinnedFirst(rows.filter((r) => r.groupId === group.id)),
  }));
  out.push({
    group: null,
    rows: pinnedFirst(rows.filter((r) => !r.groupId || !known.has(r.groupId))),
  });
  return out.filter((s) => s.rows.length > 0);
}
