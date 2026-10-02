import { CoreError } from "../errors";
import type { RandomPort } from "../ports";
import { MAX_GROUP_NAME, MAX_GROUPS, MAX_GROUPS_BYTES, type VaultGroup } from "./format";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// Control characters and bidi overrides could make one name look like another.
const FORBIDDEN = /[\p{Cc}‪-‮⁦-⁩]/u;

/** Comparison key: NFC + case fold; strips the combining dot that Turkish "İ" leaves after lower-casing. */
export const groupNameKey = (name: string) =>
  name.normalize("NFC").toLocaleLowerCase("en").replace(/̇/g, "");

export function normalizeGroupName(raw: string): string {
  const name = raw.trim().normalize("NFC");
  const length = [...name].length;
  if (LONE_SURROGATE.test(name) || FORBIDDEN.test(name) || length < 1 || length > MAX_GROUP_NAME)
    throw new CoreError("invalid-group-name", "Group name must be 1–40 characters");
  return name;
}

/** Throws duplicate-group when another group already uses the name. */
export function assertNameFree(groups: readonly VaultGroup[], name: string, exceptId?: string) {
  const key = groupNameKey(name);
  if (groups.some((g) => g.id !== exceptId && groupNameKey(g.name) === key))
    throw new CoreError("duplicate-group", "A group with this name already exists");
}

export function assertFits(groups: readonly VaultGroup[]) {
  if (
    groups.length > MAX_GROUPS ||
    new TextEncoder().encode(JSON.stringify(groups)).length > MAX_GROUPS_BYTES
  )
    throw new CoreError("group-limit", "Too many groups");
}

export function newGroupId(random: RandomPort, groups: readonly VaultGroup[]): string {
  for (;;) {
    const id = Array.from(random.bytes(6), (b) => b.toString(16).padStart(2, "0")).join("");
    if (!groups.some((g) => g.id === id)) return id;
  }
}

export function withoutGroup<T extends { groupId?: string }>(account: T): T {
  const copy = { ...account };
  delete copy.groupId;
  return copy;
}
