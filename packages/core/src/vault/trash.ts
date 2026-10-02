import { z } from "zod";
import { accountSchema, type Account } from "../account/account";
import { CoreError, isQuotaError } from "../errors";
import type { ClockPort, RandomPort, StoragePort } from "../ports";
import { encryptedRecordSchema, isNewerVersion } from "./format";
import { decryptRecord, encryptRecord } from "./records";

// Outside the `vault:` namespace on purpose: vault moves, copies, inspection and sync never see these keys.
export const TRASH_PREFIX = "trash:";
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TRASH_ENTRIES = 100;
// storage.local is 5-10 MiB and shared with up to 7 vault copies; the bin stays a small share of it.
export const MAX_TRASH_BYTES = 200_000;

export const trashKey = (id: string) => `${TRASH_PREFIX}${id}`;
export const isTrashKey = (key: string) => key.startsWith(TRASH_PREFIX);

export const trashEntrySchema = z.object({ account: accountSchema, deletedAt: z.number() });
export type TrashEntry = z.infer<typeof trashEntrySchema>;

/** What a caller outside the vault may see: never the secret. */
export interface TrashItem {
  id: string;
  issuer: string;
  label: string;
  deletedAt: number;
  expiresAt: number;
}

export const trashItemOf = (entry: TrashEntry): TrashItem => ({
  id: entry.account.id,
  issuer: entry.account.issuer,
  label: entry.account.label,
  deletedAt: entry.deletedAt,
  expiresAt: entry.deletedAt + TRASH_TTL_MS,
});

interface Slot {
  key: string;
  bytes: number;
  /** Authenticated deletedAt; -Infinity for anything this key cannot open. */
  at: number;
  /** Written by a newer client: counted, never evicted. */
  keep: boolean;
}

// Timestamps beyond now + TTL (clock ran ahead, or forged) count as expired too.
const isExpired = (now: number, deletedAt: number): boolean =>
  Math.abs(now - deletedAt) >= TRASH_TTL_MS;

/** Callers hold the vault lock; nothing here locks. */
export class TrashStore {
  constructor(
    private readonly port: StoragePort,
    private readonly dek: Uint8Array,
    private readonly random: RandomPort,
    private readonly clock: ClockPort,
  ) {}

  /** Eviction order: unreadable values first, then readable ones by authenticated deletedAt (oldest first). */
  private async slots(): Promise<Slot[]> {
    const out: Slot[] = [];
    for (const [key, value] of Object.entries(await this.port.get())) {
      if (!isTrashKey(key)) continue;
      // The outer updatedAt is unauthenticated and never decides the order.
      const entry = await this.read(key, value);
      out.push({
        key,
        bytes: key.length + JSON.stringify(value).length,
        keep: isNewerVersion(value, "v"),
        at: entry ? entry.deletedAt : Number.NEGATIVE_INFINITY,
      });
    }
    return out.sort((x, y) => x.at - y.at || x.key.localeCompare(y.key));
  }

  /** Best effort by design: the delete this protects must never fail because of the bin. */
  async put(account: Account): Promise<boolean> {
    const deletedAt = this.clock.now();
    const key = trashKey(account.id);
    try {
      const sealed = await encryptRecord(
        this.dek,
        key,
        { account, deletedAt },
        deletedAt,
        this.random,
      );
      try {
        await this.port.set({ [key]: sealed });
      } catch (e) {
        if (!isQuotaError(e)) return false;
        const oldest = (await this.slots()).find((s) => s.key !== key && !s.keep);
        if (!oldest) return false;
        await this.port.remove([oldest.key]);
        await this.port.set({ [key]: sealed });
      }
    } catch {
      return false;
    }
    try {
      await this.prune(key);
    } catch {
      // The entry is stored; pruning retries on the next delete.
    }
    return true;
  }

  private async prune(keep: string): Promise<void> {
    const slots = await this.slots();
    let count = slots.length;
    let bytes = slots.reduce((n, s) => n + s.bytes, 0);
    const doomed: string[] = [];
    for (const slot of slots) {
      if (count <= MAX_TRASH_ENTRIES && bytes <= MAX_TRASH_BYTES) break;
      if (slot.key === keep || slot.keep) continue;
      doomed.push(slot.key);
      count--;
      bytes -= slot.bytes;
    }
    if (doomed.length) await this.port.remove(doomed);
  }

  async drop(id: string): Promise<void> {
    try {
      await this.port.remove([trashKey(id)]);
    } catch {
      // Best effort; an orphan entry ages out like any other.
    }
  }

  private async read(key: string, value: unknown): Promise<TrashEntry | null> {
    const record = encryptedRecordSchema.safeParse(value);
    if (!record.success) return null;
    const entry = await decryptRecord(this.dek, key, record.data, trashEntrySchema);
    // The AAD already binds the blob to its key; the inner id is checked as well.
    return entry && trashKey(entry.account.id) === key ? entry : null;
  }

  /** Readable, unexpired entries, newest first. Anything else is skipped silently. */
  async list(live: ReadonlySet<string>): Promise<TrashEntry[]> {
    const now = this.clock.now();
    const out: TrashEntry[] = [];
    for (const [key, value] of Object.entries(await this.port.get())) {
      if (!isTrashKey(key)) continue;
      const entry = await this.read(key, value);
      if (entry && !live.has(entry.account.id) && !isExpired(now, entry.deletedAt)) out.push(entry);
    }
    return out.sort(
      (a, b) => b.deletedAt - a.deletedAt || a.account.id.localeCompare(b.account.id),
    );
  }

  async open(id: string): Promise<TrashEntry> {
    const key = trashKey(id);
    const raw = (await this.port.get([key]))[key];
    if (raw === undefined) throw new CoreError("trash-entry-not-found", "Not in recently deleted");
    if (isNewerVersion(raw, "v"))
      throw new CoreError("unsupported-format", "This entry was saved by a newer version");
    const entry = await this.read(key, raw);
    if (!entry) throw new CoreError("trash-corrupt", "This entry cannot be read");
    if (isExpired(this.clock.now(), entry.deletedAt)) {
      await this.drop(id);
      throw new CoreError("trash-entry-not-found", "Not in recently deleted");
    }
    return entry;
  }

  /** Removes expired entries, entries whose id is live again, and values that are not records at all. Returns the removed count. */
  async purgeExpired(live: ReadonlySet<string>): Promise<number> {
    const now = this.clock.now();
    const doomed: string[] = [];
    for (const [key, value] of Object.entries(await this.port.get())) {
      // A newer client's blob is never this version's to delete.
      if (!isTrashKey(key) || isNewerVersion(value, "v")) continue;
      const record = encryptedRecordSchema.safeParse(value);
      if (!record.success) {
        doomed.push(key);
        continue;
      }
      const entry = await this.read(key, value);
      const expired = entry
        ? live.has(entry.account.id) || isExpired(now, entry.deletedAt)
        : record.data.updatedAt > now + TRASH_TTL_MS || now - record.data.updatedAt >= TRASH_TTL_MS;
      if (expired) doomed.push(key);
    }
    if (doomed.length) await this.port.remove(doomed);
    return doomed.length;
  }

  async clear(): Promise<number> {
    const keys = Object.keys(await this.port.get()).filter(isTrashKey);
    if (keys.length) await this.port.remove(keys);
    return keys.length;
  }
}
