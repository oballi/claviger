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

export interface SortSection<T> {
  group: GroupView | null;
  fixed: T[];
  movable: T[];
}

/** Sort-mode sections: every group (even empty ones, as drop targets), pinned rows fixed in front. */
export function sortSectionsOf<T extends { groupId: string | null; pinned: boolean }>(
  rows: readonly T[],
  groups: readonly GroupView[],
): SortSection<T>[] {
  const known = new Set(groups.map((g) => g.id));
  const split = (list: T[]) => ({
    fixed: list.filter((r) => r.pinned),
    movable: list.filter((r) => !r.pinned),
  });
  const loose = rows.filter((r) => !r.groupId || !known.has(r.groupId));
  const out: SortSection<T>[] = groups.map((group) => ({
    group,
    ...split(rows.filter((r) => r.groupId === group.id)),
  }));
  if (groups.length > 0 || loose.length > 0) out.push({ group: null, ...split(loose) });
  return out;
}
