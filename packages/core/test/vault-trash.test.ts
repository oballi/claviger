// packages/core/test/vault-trash.test.ts
import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { moveVaultData } from "../src/vault/migrate";
import { MAX_TRASH_BYTES, MAX_TRASH_ENTRIES, TRASH_TTL_MS } from "../src/vault/trash";
import { Vault } from "../src/vault/vault";
import type { VaultDeps } from "../src/ports";
import { FakeClock, MemoryStorage } from "../src/testing";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

const SECRET = "JBSWY3DPEHPK3PXP";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const secretFor = (i: number) => `JBSWY3DPEHPK${B32[(i >> 5) & 31]}${B32[i & 31]}AA`;

const add = (vault: Vault, issuer: string, secret = SECRET) =>
  vault.addAccount(normalizeAccountInput({ secret, issuer, label: `${issuer}@example.com` }));
const trashKeys = (s: MemoryStorage) => [...s.data.keys()].filter((k) => k.startsWith("trash:"));

async function setup(opts: { sameStorage?: boolean } = {}) {
  const base = makeDeps();
  const trash = opts.sameStorage ? base.storage : new MemoryStorage();
  const deps: VaultDeps & { storage: MemoryStorage; clock: FakeClock } = { ...base, trash };
  const { vault } = await Vault.create(deps, { password: "pw-test-1", createRecoveryCode: false });
  return { vault, deps, trash: trash as MemoryStorage, clock: base.clock };
}

describe("deleting moves the account into the bin", () => {
  it("lists the deleted account without its secret and hides it from the live list", async () => {
    const { vault, clock } = await setup();
    const a = await add(vault, "GitHub");
    await vault.deleteAccount(a.id);
    expect((await vault.listAccounts()).accounts).toEqual([]);
    const items = await vault.listTrash();
    expect(items).toEqual([
      {
        id: a.id,
        issuer: "GitHub",
        label: "GitHub@example.com",
        deletedAt: clock.now(),
        expiresAt: clock.now() + TRASH_TTL_MS,
      },
    ]);
    expect(JSON.stringify(items)).not.toContain(SECRET);
  });

  it("stores only ciphertext under a trash: key", async () => {
    const { vault, trash } = await setup();
    const a = await add(vault, "GitHub");
    await vault.deleteAccount(a.id);
    expect(trashKeys(trash)).toEqual([`trash:${a.id}`]);
    const dump = JSON.stringify([...trash.data]);
    for (const plain of [SECRET, "GitHub", "example.com", "totp"])
      expect(dump).not.toContain(plain);
  });

  it("keeps trash keys out of vault inspection and storage moves", async () => {
    const { vault, deps } = await setup({ sameStorage: true });
    const a = await add(vault, "A", secretFor(1));
    await add(vault, "B", secretFor(2));
    await vault.deleteAccount(a.id);
    expect(await Vault.inspect(deps.storage)).toMatchObject({ status: "ok", accountCount: 1 });
    const target = new MemoryStorage();
    await moveVaultData(deps.storage, target);
    expect([...target.data.keys()].some((k) => k.startsWith("trash:"))).toBe(false);
  });

  it("works on a local vault where bin and vault share one storage (no lock deadlock)", async () => {
    const { vault } = await setup({ sameStorage: true });
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    const restored = await vault.restoreFromTrash(a.id);
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([restored.id]);
  });

  it("still deletes when the host passes no bin", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, {
      password: "pw-test-1",
      createRecoveryCode: false,
    });
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    expect(await vault.listTrash()).toEqual([]);
    expect(await asyncCodeOf(vault.restoreFromTrash(a.id))).toBe("trash-entry-not-found");
    expect(await vault.emptyTrash()).toBe(0);
  });

  it("does not bin an account that was already deleted (hidden by its tombstone)", async () => {
    const { vault, deps, trash } = await setup();
    const a = await add(vault, "A");
    const record = deps.storage.data.get(`vault:acct:${a.id}`);
    await vault.deleteAccount(a.id);
    await vault.emptyTrash();
    // A stale copy reappears under the old key (sync replay); deleting it again must not bin it.
    deps.storage.data.set(`vault:acct:${a.id}`, record);
    await vault.deleteAccount(a.id);
    expect(trashKeys(trash)).toEqual([]);
  });
});

describe("the delete never fails because of the bin", () => {
  it("deletes even when the bin cannot be written and an empty bin has nothing to evict", async () => {
    const { vault, trash } = await setup();
    const a = await add(vault, "A");
    trash.failNextSet = new Error("QuotaExceededError");
    await expect(vault.deleteAccount(a.id)).resolves.toBeUndefined();
    expect((await vault.listAccounts()).accounts).toEqual([]);
    expect(await vault.listTrash()).toEqual([]);
  });

  it("evicts the oldest entry once to make room, then stores the new one", async () => {
    const { vault, trash, clock } = await setup();
    const a = await add(vault, "A", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(a.id);
    clock.advance(1000);
    trash.failNextSet = new Error("QuotaExceededError");
    await vault.deleteAccount(b.id);
    expect((await vault.listTrash()).map((i) => i.id)).toEqual([b.id]);
  });

  it("leaves no bin entry behind when the vault write itself fails", async () => {
    const { vault, deps, trash } = await setup();
    const a = await add(vault, "A");
    deps.storage.failNextSet = new Error("boom");
    await expect(vault.deleteAccount(a.id)).rejects.toThrow("boom");
    expect(trashKeys(trash)).toEqual([]);
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([a.id]);
  });
});

describe("restore", () => {
  it("brings the account back under a fresh id, appended and unpinned, keeping its data", async () => {
    const { vault } = await setup();
    const a = await add(vault, "A", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    await vault.setPinned(a.id, true);
    await vault.deleteAccount(a.id);
    const restored = await vault.restoreFromTrash(a.id);
    expect(restored.id).not.toBe(a.id);
    expect(restored).toMatchObject({
      issuer: "A",
      label: "A@example.com",
      secret: a.secret,
      createdAt: a.createdAt,
      domains: a.domains,
    });
    const listing = await vault.listAccounts();
    expect(listing.accounts.map((x) => x.id)).toEqual([b.id, restored.id]);
    expect(listing.pinned).toEqual([]);
    expect(await vault.listTrash()).toEqual([]);
    expect(await asyncCodeOf(vault.getAccount(a.id))).toBe("account-not-found");
  });

  it("keeps the HOTP counter", async () => {
    const { vault } = await setup();
    const h = await vault.addAccount(
      normalizeAccountInput({ secret: SECRET, type: "hotp", issuer: "H" }),
    );
    await vault.incrementHotp(h.id);
    await vault.incrementHotp(h.id);
    await vault.deleteAccount(h.id);
    expect((await vault.restoreFromTrash(h.id)).counter).toBe(2);
  });

  it("keeps the group while it exists and drops it once the group is gone", async () => {
    const { vault } = await setup();
    const g = await vault.createGroup("Work");
    const a = await add(vault, "A");
    await vault.updateAccount(a.id, { groupId: g.id });
    await vault.deleteAccount(a.id);
    const first = await vault.restoreFromTrash(a.id);
    expect(first.groupId).toBe(g.id);
    await vault.deleteAccount(first.id);
    await vault.deleteGroup(g.id);
    const second = await vault.restoreFromTrash(first.id);
    expect(second.groupId).toBeUndefined();
  });

  it("refuses a duplicate of a live account and leaves the entry in the bin", async () => {
    const { vault } = await setup();
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    await add(vault, "A again", SECRET);
    expect(await asyncCodeOf(vault.restoreFromTrash(a.id))).toBe("duplicate-account");
    expect((await vault.listTrash()).map((i) => i.id)).toEqual([a.id]);
    expect((await vault.listAccounts()).accounts).toHaveLength(1);
  });

  it("allowDuplicate restores next to a live copy under a new id", async () => {
    const { vault } = await setup();
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    const live = await add(vault, "A again", SECRET);
    const restored = await vault.restoreFromTrash(a.id, { allowDuplicate: true });
    expect(restored.id).not.toBe(a.id);
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([live.id, restored.id]);
    expect(await vault.listTrash()).toEqual([]);
  });

  it("two simultaneous restores yield exactly one account", async () => {
    const { vault } = await setup();
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    const results = await Promise.allSettled([
      vault.restoreFromTrash(a.id),
      vault.restoreFromTrash(a.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { code?: string }).code).toBe("trash-entry-not-found");
    expect((await vault.listAccounts()).accounts).toHaveLength(1);
  });

  it("is visible to a device that already holds the tombstone, and a stale offline copy stays hidden", async () => {
    const { vault, deps } = await setup();
    const a = await add(vault, "A");
    const stale = deps.storage.data.get(`vault:acct:${a.id}`);
    await vault.deleteAccount(a.id);
    const other = new MemoryStorage();
    await other.set(await deps.storage.get());
    const restored = await vault.restoreFromTrash(a.id);
    // Sync delivers the changed keys, plus an old copy of the deleted record from an offline device.
    await other.set({ ...(await deps.storage.get()), [`vault:acct:${a.id}`]: stale });
    expect(other.data.has(`vault:tomb:${a.id}`)).toBe(true);
    const second = await Vault.fromKey(
      { storage: other, random: deps.random, clock: deps.clock, kdf: deps.kdf },
      vault.exportKey(),
    );
    expect((await second.listAccounts()).accounts.map((x) => x.id)).toEqual([restored.id]);
  });

  it("still works after a password change (the data key is unchanged)", async () => {
    const { vault, deps } = await setup();
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    await vault.changePassword("another-pw-2");
    const again = await Vault.unlockWithPassword(deps, "another-pw-2");
    expect((await again.restoreFromTrash(a.id)).issuer).toBe("A");
  });
});

describe("a tampered or foreign bin fails closed", () => {
  it("rejects a blob moved to another bin key", async () => {
    const { vault, trash } = await setup();
    const a = await add(vault, "A", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(a.id);
    await vault.deleteAccount(b.id);
    trash.data.set(`trash:${b.id}`, trash.data.get(`trash:${a.id}`));
    expect(await asyncCodeOf(vault.restoreFromTrash(b.id))).toBe("trash-corrupt");
    expect((await vault.listTrash()).map((i) => i.id)).toEqual([a.id]);
  });

  it("rejects a live account record copied into the bin", async () => {
    const { vault, deps, trash } = await setup();
    const c = await add(vault, "C");
    trash.data.set(`trash:${c.id}`, deps.storage.data.get(`vault:acct:${c.id}`));
    expect(await asyncCodeOf(vault.restoreFromTrash(c.id))).toBe("trash-corrupt");
    expect(await vault.listTrash()).toEqual([]);
    expect((await vault.listAccounts()).accounts).toHaveLength(1);
  });

  it("puts no secret, name or id of the account into the error", async () => {
    const { vault, trash } = await setup();
    const a = await add(vault, "TopSecretIssuer", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(a.id);
    await vault.deleteAccount(b.id);
    trash.data.set(`trash:${b.id}`, trash.data.get(`trash:${a.id}`));
    const error = await vault.restoreFromTrash(b.id).catch((e: Error) => e);
    const text = JSON.stringify({
      message: (error as Error).message,
      cause: (error as Error).cause,
    });
    for (const leak of [a.secret, "TopSecretIssuer", "example.com"])
      expect(text).not.toContain(leak);
    expect((error as Error).cause).toBeUndefined();
  });

  it("ignores another vault's entries and ages them out", async () => {
    const { vault, trash, clock } = await setup();
    const other = await Vault.create(
      { ...makeDeps(), clock, trash },
      { password: "pw-test-2", createRecoveryCode: false },
    );
    const foreign = await add(other.vault, "Foreign", secretFor(9));
    await other.vault.deleteAccount(foreign.id);
    expect(await vault.listTrash()).toEqual([]);
    expect(await asyncCodeOf(vault.restoreFromTrash(foreign.id))).toBe("trash-corrupt");
    expect(await vault.purgeExpiredTrash()).toBe(0);
    clock.advance(TRASH_TTL_MS);
    expect(await vault.purgeExpiredTrash()).toBe(1);
    expect(trashKeys(trash)).toEqual([]);
  });

  it("removes malformed bin values on purge but leaves a newer-version blob alone", async () => {
    const { vault, trash } = await setup();
    trash.data.set("trash:junk", { nonsense: true });
    trash.data.set("trash:future", { v: 2, iv: "x", ct: "y", updatedAt: 1 });
    expect(await asyncCodeOf(vault.restoreFromTrash("junk"))).toBe("trash-corrupt");
    expect(await asyncCodeOf(vault.restoreFromTrash("future"))).toBe("unsupported-format");
    expect(await vault.purgeExpiredTrash()).toBe(1);
    expect(trashKeys(trash)).toEqual(["trash:future"]);
  });
});

describe("retention and limits", () => {
  it("hides an entry exactly at 30 days and removes it on purge", async () => {
    const { vault, trash, clock } = await setup();
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    clock.advance(TRASH_TTL_MS - 1);
    expect(await vault.listTrash()).toHaveLength(1);
    clock.advance(1);
    expect(await vault.listTrash()).toEqual([]);
    expect(await asyncCodeOf(vault.restoreFromTrash(a.id))).toBe("trash-entry-not-found");
    expect(await vault.purgeExpiredTrash()).toBe(0); // restore already dropped it
    expect(trashKeys(trash)).toEqual([]);
  });

  it("purgeExpiredTrash removes expired readable entries and keeps fresh ones", async () => {
    const { vault, trash, clock } = await setup();
    const a = await add(vault, "A", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(a.id);
    clock.advance(TRASH_TTL_MS / 2);
    await vault.deleteAccount(b.id);
    clock.advance(TRASH_TTL_MS / 2);
    expect(await vault.purgeExpiredTrash()).toBe(1);
    expect(trashKeys(trash)).toEqual([`trash:${b.id}`]);
  });

  it("keeps at most 100 entries, dropping the oldest, and lists the newest first", async () => {
    const { vault, clock } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < MAX_TRASH_ENTRIES + 1; i++) {
      const a = await add(vault, `S${i}`, secretFor(i));
      ids.push(a.id);
      clock.advance(1000);
      await vault.deleteAccount(a.id);
    }
    const kept = await vault.listTrash();
    expect(kept).toHaveLength(MAX_TRASH_ENTRIES);
    expect(kept.some((i) => i.id === ids[0])).toBe(false);
    expect(kept[0]!.id).toBe(ids[MAX_TRASH_ENTRIES]);
  }, 60_000);
});

describe("permanent removal touches the bin only", () => {
  it("purges one entry (idempotently) and empties the bin without touching live data or tombstones", async () => {
    const { vault, deps, trash } = await setup();
    const a = await add(vault, "A", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    const live = await add(vault, "Live", secretFor(3));
    await vault.deleteAccount(a.id);
    await vault.deleteAccount(b.id);
    await vault.purgeTrashEntry(a.id);
    await vault.purgeTrashEntry(a.id);
    expect(trashKeys(trash)).toEqual([`trash:${b.id}`]);
    expect(await vault.emptyTrash()).toBe(1);
    expect(trashKeys(trash)).toEqual([]);
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([live.id]);
    expect(deps.storage.data.has(`vault:tomb:${a.id}`)).toBe(true);
    expect(deps.storage.data.has(`vault:tomb:${b.id}`)).toBe(true);
  });
});

describe("amendments: ordering, live ids, quota-only eviction", () => {
  it("drops an oversized unreadable blob with a future timestamp instead of a readable entry", async () => {
    const { vault, trash, clock } = await setup();
    const a = await add(vault, "A", secretFor(1));
    await vault.deleteAccount(a.id);
    clock.advance(1000);
    const blob = {
      v: 1,
      iv: "x",
      ct: "y".repeat(MAX_TRASH_BYTES - 1000),
      updatedAt: clock.now() + 10 * TRASH_TTL_MS,
    };
    trash.data.set("trash:big", blob);
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(b.id);
    expect(trashKeys(trash).sort()).toEqual([`trash:${a.id}`, `trash:${b.id}`].sort());
  });

  it("purge removes entries with a deletedAt far in the future and unreadable blobs with a future updatedAt", async () => {
    const { vault, trash, clock } = await setup();
    trash.data.set("trash:ahead", {
      v: 1,
      iv: "x",
      ct: "y",
      updatedAt: clock.now() + 2 * TRASH_TTL_MS,
    });
    expect(await vault.purgeExpiredTrash()).toBe(1);
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    clock.advance(-3 * TRASH_TTL_MS); // clock was ahead when the entry was written
    expect(await vault.purgeExpiredTrash()).toBe(1);
    expect(trashKeys(trash)).toEqual([]);
  });

  it("hides an entry whose id is live again and purges it", async () => {
    const { vault, deps, trash } = await setup();
    const a = await add(vault, "A");
    const record = deps.storage.data.get(`vault:acct:${a.id}`);
    await vault.deleteAccount(a.id);
    expect((await vault.listTrash()).map((i) => i.id)).toEqual([a.id]);
    // A replayed newer copy makes the id live again.
    const tomb = deps.storage.data.get(`vault:tomb:${a.id}`) as { deletedAt: number };
    deps.storage.data.delete(`vault:tomb:${a.id}`);
    deps.storage.data.set(`vault:acct:${a.id}`, record);
    void tomb;
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([a.id]);
    expect(await vault.listTrash()).toEqual([]);
    expect(await vault.purgeExpiredTrash()).toBe(1);
    expect(trashKeys(trash)).toEqual([]);
  });

  it("does not evict on a non-quota write error; the delete still succeeds", async () => {
    const { vault, trash, clock } = await setup();
    const a = await add(vault, "A", secretFor(1));
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(a.id);
    clock.advance(1000);
    trash.failNextSet = new Error("disk on fire");
    await expect(vault.deleteAccount(b.id)).resolves.toBeUndefined();
    expect((await vault.listTrash()).map((i) => i.id)).toEqual([a.id]);
  });
});

describe("fix round 1", () => {
  it("purgeExpiredTrash does not throw when the vault holds a newer-version record", async () => {
    const { vault, deps, trash } = await setup();
    trash.data.set("trash:junk", { nonsense: true });
    deps.storage.data.set("vault:acct:future", { v: 2, iv: "x", ct: "y", updatedAt: 1 });
    expect(await vault.purgeExpiredTrash()).toBe(1);
  });

  it("an entry with deletedAt beyond now + TTL is neither listed nor restorable", async () => {
    const { vault, clock } = await setup();
    const a = await add(vault, "A");
    await vault.deleteAccount(a.id);
    clock.advance(-(TRASH_TTL_MS + 1));
    expect(await vault.listTrash()).toEqual([]);
    expect(await asyncCodeOf(vault.restoreFromTrash(a.id))).toBe("trash-entry-not-found");
  });

  it("never evicts a newer-version blob, but counts its bytes toward the cap", async () => {
    const { vault, trash, clock } = await setup();
    const a = await add(vault, "A", secretFor(1));
    await vault.deleteAccount(a.id);
    clock.advance(1000);
    const future = { v: 2, iv: "x", ct: "y".repeat(MAX_TRASH_BYTES), updatedAt: 1 };
    trash.data.set("trash:future", future);
    const b = await add(vault, "B", secretFor(2));
    await vault.deleteAccount(b.id);
    expect(trashKeys(trash).sort()).toEqual(["trash:future", `trash:${b.id}`].sort());
    // Quota path must skip it as well.
    clock.advance(1000);
    const c = await add(vault, "C", secretFor(3));
    trash.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    await vault.deleteAccount(c.id);
    expect(trash.data.has("trash:future")).toBe(true);
  });
});
