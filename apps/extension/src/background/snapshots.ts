import "../zodConfig";
import {
  HEADER_KEY,
  isTrashKey,
  isVaultKey,
  Vault,
  type ClockPort,
  type RandomPort,
  type StoragePort,
} from "@claviger/core";
import { SNAPSHOT_REASONS, type SnapshotReason } from "@claviger/ui/protocol";
import { z } from "zod";

export const SNAPSHOT_PREFIX = "snapshot:";
export const QUARANTINE_PREFIX = "quarantine:";
export const MAX_SNAPSHOTS = 7;
export class NotCorruptError extends Error {}

export const DAY_MS = 86_400_000;

export type { SnapshotReason };

const snapshotSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  createdAt: z.number(),
  reason: z.enum(SNAPSHOT_REASONS),
  vaultId: z.string().min(1),
  accountCount: z.number().int().nonnegative(),
  digest: z.string(),
  records: z.record(z.string(), z.unknown()),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** Read-only view so the core Vault opens a snapshot exactly like a live vault. */
export function recordsStorage(records: Record<string, unknown>): StoragePort {
  const readOnly = async () => {
    throw new Error("Snapshot storage is read-only");
  };
  return {
    get: async (keys) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(records))
        if (!keys || keys.includes(key)) out[key] = structuredClone(value);
      return out;
    },
    set: readOnly,
    remove: readOnly,
  };
}

/** Key order differs between storage backends, so comparisons and digests must not depend on it. */
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sorted(value));
}

async function digestOf(records: Record<string, unknown>): Promise<string> {
  const canonical = canonicalJson(
    Object.keys(records)
      .sort()
      .map((key) => [key, records[key]]),
  );
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

const SITE_MEMORY_KEY = "vault:sitemem";

const vaultRecords = (all: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(all).filter(([key]) => isVaultKey(key)));

export class SnapshotStore {
  constructor(
    private readonly local: StoragePort,
    private readonly clock: ClockPort,
    private readonly random: RandomPort,
  ) {}

  async list(): Promise<Snapshot[]> {
    const out: Snapshot[] = [];
    for (const [key, value] of Object.entries(await this.local.get())) {
      if (!key.startsWith(SNAPSHOT_PREFIX)) continue;
      const parsed = snapshotSchema.safeParse(value);
      if (parsed.success) out.push(parsed.data);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  async get(id: string): Promise<Snapshot | null> {
    const raw = (await this.local.get([SNAPSHOT_PREFIX + id]))[SNAPSHOT_PREFIX + id];
    const parsed = snapshotSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async take(source: StoragePort, reason: SnapshotReason): Promise<Snapshot | null> {
    const records = vaultRecords(await source.get());
    // Site memory is browsing history: never capture it, so turning it off leaves no copy behind.
    // Copies taken before this change keep what they have until they rotate out.
    delete records[SITE_MEMORY_KEY];
    const info = await Vault.inspect(recordsStorage(records));
    if (info.status !== "ok") return null;
    const digest = await digestOf(records);
    const existing = await this.list();
    if (existing[0]?.digest === digest) return null;
    const createdAt = this.clock.now();
    const snapshot: Snapshot = {
      v: 1,
      id: `${createdAt}-${this.random.uuid()}`,
      createdAt,
      reason,
      vaultId: (records[HEADER_KEY] as { vaultId: string }).vaultId,
      accountCount: info.accountCount ?? 0,
      digest,
      records,
    };
    try {
      await this.local.set({ [SNAPSHOT_PREFIX + snapshot.id]: snapshot });
    } catch (cause) {
      // Usually a full storage.local: make room once, then give up.
      // The newest non-empty copy backs the "vault is empty" restore offer; never evict it.
      const protectedId = existing.find((s) => s.accountCount > 0)?.id;
      const victim = [...existing].reverse().find((s) => s.id !== protectedId);
      if (!victim) throw new Error("Snapshot could not be stored", { cause });
      await this.local.remove([SNAPSHOT_PREFIX + victim.id]);
      existing.splice(existing.indexOf(victim), 1);
      try {
        await this.local.set({ [SNAPSHOT_PREFIX + snapshot.id]: snapshot });
      } catch (retryCause) {
        throw new Error("Snapshot could not be stored", { cause: retryCause });
      }
    }
    try {
      const all = [snapshot, ...existing];
      const keep = new Set(all.slice(0, MAX_SNAPSHOTS).map((s) => s.id));
      const newestNonEmpty = all.find((s) => s.accountCount > 0);
      if (newestNonEmpty) keep.add(newestNonEmpty.id);
      const stale = all.filter((s) => !keep.has(s.id)).map((s) => SNAPSHOT_PREFIX + s.id);
      if (stale.length) await this.local.remove(stale);
    } catch {
      // Pruning is best effort; the new copy is already stored.
    }
    return snapshot;
  }

  async takeDaily(source: StoragePort): Promise<Snapshot | null> {
    const newest = (await this.list())[0];
    const now = this.clock.now();
    // A newest copy "from the future" means the clock went back; it must not block copies for days.
    if (newest && now - newest.createdAt < DAY_MS && newest.createdAt <= now) return null;
    return this.take(source, "daily");
  }

  /** Replaces the header in every copy of this vault so revoked keyslots stay revoked. */
  async rekey(vaultId: string, header: unknown): Promise<number> {
    if (
      typeof header !== "object" ||
      header === null ||
      (header as { vaultId?: unknown }).vaultId !== vaultId
    )
      throw new Error("Header does not belong to this vault");
    let count = 0;
    for (const snap of await this.list()) {
      if (snap.vaultId !== vaultId) continue;
      const records = { ...snap.records, [HEADER_KEY]: structuredClone(header) };
      // A mid-loop failure is handled by the caller deleting the copies (A7).
      if ((await Vault.inspect(recordsStorage(records))).status !== "ok")
        throw new Error("Header is not a valid vault header");
      const updated: Snapshot = { ...snap, records, digest: await digestOf(records) };
      await this.local.set({ [SNAPSHOT_PREFIX + snap.id]: updated });
      count++;
    }
    return count;
  }

  async removeVault(vaultId: string): Promise<void> {
    const keys = (await this.list())
      .filter((s) => s.vaultId === vaultId)
      .map((s) => SNAPSHOT_PREFIX + s.id);
    if (keys.length) await this.local.remove(keys);
  }

  async quarantine(source: StoragePort): Promise<number> {
    const records = vaultRecords(await source.get());
    if (Object.keys(records).length === 0) return 0;
    // A sync arrival may have repaired the vault since the caller inspected it.
    if ((await Vault.inspect(recordsStorage(records))).status !== "corrupt")
      throw new NotCorruptError("The vault is no longer corrupt");
    const createdAt = this.clock.now();
    const key = `${QUARANTINE_PREFIX}${createdAt}-${this.random.uuid()}`;
    // Write first: the source is only cleared once the copy exists.
    await this.local.set({ [key]: { v: 1, createdAt, records } });
    const keys = Object.keys(records);
    if (keys.length) await source.remove(keys);
    return keys.length;
  }

  async removeAll(): Promise<void> {
    // The bin is sealed under the deleted vault's key; nothing can open it any more.
    const keys = Object.keys(await this.local.get()).filter(
      (k) => k.startsWith(SNAPSHOT_PREFIX) || k.startsWith(QUARANTINE_PREFIX) || isTrashKey(k),
    );
    if (keys.length) await this.local.remove(keys);
  }
}
