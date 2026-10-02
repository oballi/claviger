import { accountFingerprint, type Account } from "./account";

export type DuplicateKind = "exact" | "same-secret" | "similar";
export interface DuplicateGroup {
  kind: DuplicateKind;
  ids: string[];
}

const paramsKey = (a: Account) => `${a.algorithm}|${a.digits}|${a.type === "totp" ? a.period : 0}`;
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const order = (a: Account, b: Account) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Same secret and same code-affecting settings; issuer, label and HOTP counter may differ. */
export const isExactDuplicate = (a: Account, b: Account): boolean =>
  accountFingerprint(a) === accountFingerprint(b) && paramsKey(a) === paramsKey(b);

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function findDuplicateGroups(accounts: Account[]): DuplicateGroup[] {
  const sorted = [...accounts].sort(order);
  const groups: DuplicateGroup[] = [];

  const byFingerprint = new Map<string, Account[]>();
  for (const a of sorted) push(byFingerprint, accountFingerprint(a), a);
  for (const bucket of byFingerprint.values()) {
    if (bucket.length < 2) continue;
    const byParams = new Map<string, Account[]>();
    for (const a of bucket) push(byParams, paramsKey(a), a);
    for (const same of byParams.values()) {
      if (same.length > 1) groups.push({ kind: "exact", ids: same.map((a) => a.id) });
    }
    if (byParams.size > 1)
      groups.push({ kind: "same-secret", ids: [...byParams.values()].map((g) => g[0]!.id) });
  }

  const byName = new Map<string, Account[]>();
  for (const a of sorted) {
    if (!a.issuer.trim() && !a.label.trim()) continue;
    push(byName, `${norm(a.issuer)}\u0000${norm(a.label)}`, a);
  }
  for (const bucket of byName.values()) {
    if (new Set(bucket.map(accountFingerprint)).size < 2) continue;
    groups.push({ kind: "similar", ids: bucket.map((a) => a.id) });
  }

  const first = new Map(sorted.map((a, i) => [a.id, i]));
  return groups.sort((x, y) => first.get(x.ids[0]!)! - first.get(y.ids[0]!)!);
}

/** A merge must never move an HOTP counter backwards, so only the highest counter may be kept. */
export function eligibleKeepers(group: Account[]): Account[] {
  if (!group.some((a) => a.type === "hotp")) return group;
  const max = Math.max(...group.map((a) => a.counter));
  return group.filter((a) => a.counter === max);
}

export function pickKeeper(group: Account[], pinned: ReadonlySet<string> = new Set()): Account {
  const score = (a: Account) => [pinned.has(a.id) ? 1 : 0, a.groupId ? 1 : 0, a.domains.length];
  return [...eligibleKeepers(group)].sort((a, b) => {
    const [sa, sb] = [score(a), score(b)];
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i]! - sa[i]!;
    return order(a, b);
  })[0]!;
}
