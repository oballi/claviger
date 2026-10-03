import { normalizeAccountInput, Vault, webRandom } from "@claviger/core";
import { FakeClock, FAST_KDF, MemoryStorage } from "@claviger/core/testing";
import { describe, expect, it } from "vitest";
import { DAY_MS, MAX_SNAPSHOTS, recordsStorage, SnapshotStore } from "../src/background/snapshots";

const SECRET = "JBSWY3DPEHPK3PXP";
const acc = (secret: string, issuer: string, label: string) =>
  normalizeAccountInput({ secret, issuer, label });

async function setup(opts: { recovery?: boolean } = {}) {
  const clock = new FakeClock();
  const source = new MemoryStorage();
  const local = new MemoryStorage();
  const deps = { storage: source, random: webRandom, clock, kdf: FAST_KDF };
  const { vault, recoveryCode } = await Vault.create(deps, {
    password: "pw-12345678",
    createRecoveryCode: opts.recovery ?? false,
  });
  const store = new SnapshotStore(local, clock, webRandom);
  return { clock, source, local, deps, vault, store, recoveryCode };
}

/** Simulates a copy written before empty vaults were skipped. */
async function legacyEmptyCopy(local: MemoryStorage, from: { id: string }, id: string) {
  const full = (await local.get([`snapshot:${from.id}`]))[`snapshot:${from.id}`] as {
    createdAt: number;
  };
  await local.set({
    [`snapshot:${id}`]: { ...full, id, createdAt: full.createdAt + 500, accountCount: 0 },
  });
}

describe("SnapshotStore", () => {
  it("copies the encrypted vault records and counts accounts", async () => {
    const { source, store, vault } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a@x"));
    const snap = await store.take(source, "before-import");
    expect(snap).not.toBeNull();
    expect(snap!.accountCount).toBe(1);
    expect(snap!.vaultId).toBe(vault.vaultId);
    expect(Object.keys(snap!.records).every((k) => k.startsWith("vault:"))).toBe(true);
    // Stored ciphertext only: the secret never appears in plaintext.
    expect(JSON.stringify(snap)).not.toContain(SECRET);
    const opened = await Vault.fromKey(
      { storage: recordsStorage(snap!.records), random: webRandom, clock: { now: () => 0 } },
      vault.exportKey(),
    );
    expect((await opened.listAccounts()).accounts.map((a) => a.issuer)).toEqual(["Acme"]);
  });

  it("never copies the site memory record", async () => {
    const { source, store, vault } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    await source.set({ "vault:sitemem": { v: 1, data: "x" } });
    const snap = await store.take(source, "daily");
    expect(Object.keys(snap!.records)).not.toContain("vault:sitemem");
    expect(JSON.stringify(snap)).not.toContain("sitemem");
  });

  it("skips a copy identical to the newest one", async () => {
    const { source, store, clock, vault } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    expect(await store.take(source, "daily")).not.toBeNull();
    clock.advance(1000);
    expect(await store.take(source, "before-delete")).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it("keeps the newest seven", async () => {
    const { source, store, clock, vault } = await setup();
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      await vault.addAccount(acc("JBSWY3DPEHPK3PX" + "ABCDEFGHIJKLMNOP"[i]!, `I${i}`, `l${i}`));
      clock.advance(1000);
      await store.take(source, "before-import");
    }
    const list = await store.list();
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    expect(list[0]!.createdAt).toBeGreaterThan(list[1]!.createdAt);
  });

  it("skips an empty vault for every reason", async () => {
    const { source, store } = await setup();
    for (const reason of ["daily", "before-delete", "before-import", "before-restore"] as const)
      expect(await store.take(source, reason)).toBeNull();
    expect(await store.takeDaily(source)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("prunes legacy empty copies when the next copy is taken", async () => {
    const { source, store, clock, vault, local } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    const nonEmpty = await store.take(source, "daily");
    await legacyEmptyCopy(local, nonEmpty!, "legacy-empty");
    // list() is unfiltered: rekey and removeVault must still reach empty copies.
    expect((await store.list()).map((x) => x.id)).toContain("legacy-empty");
    expect(await store.removeVault(vault.vaultId)).toBeUndefined();
    expect(await store.list()).toEqual([]);

    const again = await store.take(source, "daily");
    await legacyEmptyCopy(local, again!, "legacy-empty");
    await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "B", "b"));
    clock.advance(1000);
    await store.take(source, "before-import");
    const ids = (await store.list()).map((x) => x.id);
    expect(ids).not.toContain("legacy-empty");
    expect(ids).toContain(again!.id);
  });

  it("legacy empty copies never push the newest non-empty copy out of the kept window", async () => {
    const { source, store, clock, vault, local } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    const nonEmpty = await store.take(source, "daily");
    for (let i = 0; i < MAX_SNAPSHOTS; i++) await legacyEmptyCopy(local, nonEmpty!, `legacy-${i}`);
    await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "B", "b"));
    clock.advance(1000);
    const next = await store.take(source, "before-import");
    expect((await store.list()).map((x) => x.id)).toEqual([next!.id, nonEmpty!.id]);
  });

  it("evicts a legacy empty copy first when storage is full", async () => {
    const { source, store, clock, vault, local } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    const first = await store.take(source, "daily");
    clock.advance(1000);
    await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "B", "b"));
    const second = await store.take(source, "before-import");
    await legacyEmptyCopy(local, second!, "legacy-empty");
    await vault.addAccount(acc("JBSWY3DPEHPK3PXR", "C", "c"));
    clock.advance(1000);
    local.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    const third = await store.take(source, "before-import");
    expect((await store.list()).map((x) => x.id)).toEqual([third!.id, second!.id, first!.id]);
  });

  it("rekey reaches legacy empty copies", async () => {
    const { source, store, vault, local } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    const snap = await store.take(source, "daily");
    await legacyEmptyCopy(local, snap!, "legacy-empty");
    await vault.changePassword("new-password-1");
    const header = (await source.get(["vault:header"]))["vault:header"];
    expect(await store.rekey(vault.vaultId, header)).toBe(2);
    expect((await store.get("legacy-empty"))!.records["vault:header"]).toEqual(header);
  });

  it("takes a daily copy only after a day, or when the clock went back", async () => {
    const { source, store, clock, vault } = await setup();
    await vault.addAccount(acc(SECRET, "A", "a"));
    await store.takeDaily(source);
    await vault.addAccount(acc("JBSWY3DPEHPK3PXR", "B", "b"));
    clock.advance(DAY_MS - 1);
    expect(await store.takeDaily(source)).toBeNull();
    clock.advance(1);
    expect(await store.takeDaily(source)).not.toBeNull();
    await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "C", "c"));
    clock.advance(-2 * DAY_MS);
    expect(await store.takeDaily(source)).not.toBeNull();
  });

  it("does not copy a vault whose header is corrupt", async () => {
    const { source, store } = await setup();
    await source.set({ "vault:header": { format: 1, broken: true } });
    expect(await store.take(source, "daily")).toBeNull();
  });

  it("retries once after dropping the oldest copy when the write fails", async () => {
    const { source, store, local, clock, vault } = await setup();
    await vault.addAccount(acc("JBSWY3DPEHPK3PXR", "Z", "z"));
    const oldest = await store.take(source, "daily");
    await vault.addAccount(acc("JBSWY3DPEHPK3PXS", "Y", "y"));
    clock.advance(1000);
    const protectedCopy = await store.take(source, "before-import");
    await vault.addAccount(acc(SECRET, "A", "a"));
    clock.advance(1000);
    local.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    const snap = await store.take(source, "before-import");
    expect(snap).not.toBeNull();
    // The oldest copy made room; the newest earlier one stays protected.
    expect((await store.list()).map((s) => s.id)).toEqual([snap!.id, protectedCopy!.id]);
    expect(await store.get(oldest!.id)).toBeNull();
  });

  it("never evicts the only non-empty copy when making room", async () => {
    const { source, store, local, clock, vault } = await setup();
    await vault.addAccount(acc(SECRET, "A", "a"));
    const nonEmpty = await store.take(source, "daily");
    await legacyEmptyCopy(local, nonEmpty!, "legacy-empty");
    await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "B", "b"));
    clock.advance(1000);
    local.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    const snap = await store.take(source, "before-import");
    expect(snap).not.toBeNull();
    expect((await store.list()).map((x) => x.id)).toContain(nonEmpty!.id);
  });

  it("rethrows the quota error with a cause when only the protected copy remains", async () => {
    const { source, store, local, clock, vault } = await setup();
    await vault.addAccount(acc(SECRET, "A", "a"));
    const nonEmpty = await store.take(source, "daily");
    await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "B", "b"));
    clock.advance(1000);
    const quota = new Error("QUOTA_BYTES quota exceeded");
    local.failNextSet = quota;
    await expect(store.take(source, "before-import")).rejects.toMatchObject({ cause: quota });
    expect((await store.list()).map((s) => s.id)).toEqual([nonEmpty!.id]);
  });

  it("still returns the new copy when pruning fails", async () => {
    const { source, clock, vault } = await setup();
    class FailingRemove extends MemoryStorage {
      override async remove(): Promise<void> {
        throw new Error("remove failed");
      }
    }
    const failing = new FailingRemove();
    const s2 = new SnapshotStore(failing, clock, webRandom);
    for (let i = 0; i < MAX_SNAPSHOTS + 1; i++) {
      await vault.addAccount(acc("JBSWY3DPEHPK3PX" + "ABCDEFGHIJKLMNOP"[i]!, `I${i}`, `l${i}`));
      clock.advance(1000);
      expect(await s2.take(source, "before-import")).not.toBeNull();
    }
    expect(await s2.list()).toHaveLength(MAX_SNAPSHOTS + 1);
  });

  it("quarantine of a source without vault keys writes nothing", async () => {
    const { store, local } = await setup();
    expect(await store.quarantine(new MemoryStorage())).toBe(0);
    expect(Object.keys(await local.get())).toEqual([]);
  });

  it("moves raw vault keys to quarantine and removes them from the source", async () => {
    const { source, store, local } = await setup();
    await source.set({ "vault:header": "garbage" });
    const before = await source.get();
    const moved = await store.quarantine(source);
    expect(moved).toBe(Object.keys(before).length);
    expect(Object.keys(await source.get()).filter((k) => k.startsWith("vault:"))).toEqual([]);
    const q = Object.entries(await local.get()).find(([k]) => k.startsWith("quarantine:"));
    expect((q![1] as { records: unknown }).records).toEqual(before);
  });

  it("keeps the source when the quarantine write fails", async () => {
    const { source, store, local } = await setup();
    const before = await source.get();
    local.failNextSet = new Error("disk");
    await expect(store.quarantine(source)).rejects.toThrow();
    expect(await source.get()).toEqual(before);
  });

  it("removeAll deletes snapshots and quarantine only", async () => {
    const { source, store, local } = await setup();
    await store.take(source, "daily");
    await local.set({ "quarantine:1-x": { v: 1 }, settings: { a: 1 } });
    await store.removeAll();
    expect(Object.keys(await local.get())).toEqual(["settings"]);
  });

  it("ignores malformed snapshot entries without deleting them", async () => {
    const { store, local } = await setup();
    await local.set({ "snapshot:bad": { v: 99 } });
    expect(await store.list()).toEqual([]);
    expect(await local.get(["snapshot:bad"])).toHaveProperty("snapshot:bad");
  });

  describe("rekey", () => {
    it("revokes the old password in same-vault copies and leaves other vaults alone", async () => {
      const { source, store, clock, vault, deps, local } = await setup();
      await vault.addAccount(acc(SECRET, "Acme", "a"));
      const first = await store.take(source, "daily");
      clock.advance(1000);
      await vault.addAccount(acc("JBSWY3DPEHPK3PXQ", "B", "b"));
      await store.take(source, "before-import");

      // A copy of an unrelated vault.
      const otherSource = new MemoryStorage();
      const { vault: otherVault } = await Vault.create(
        { storage: otherSource, random: webRandom, clock, kdf: FAST_KDF },
        { password: "other-pw-1234", createRecoveryCode: false },
      );
      await otherVault.addAccount(acc(SECRET, "Other", "o"));
      clock.advance(1000);
      const other = await store.take(otherSource, "daily");
      const otherBefore = structuredClone(await local.get([`snapshot:${other!.id}`]));

      await vault.changePassword("new-password-1");
      const header = (await source.get(["vault:header"]))["vault:header"];
      expect(await store.rekey(vault.vaultId, header)).toBe(2);

      for (const s of (await store.list()).filter((x) => x.vaultId === vault.vaultId)) {
        const d = { ...deps, storage: recordsStorage(s.records) };
        await expect(Vault.unlockWithPassword(d, "pw-12345678")).rejects.toMatchObject({
          code: "wrong-password",
        });
        await expect(Vault.unlockWithPassword(d, "new-password-1")).resolves.toBeDefined();
      }
      const rekeyed = await store.get(first!.id);
      const { digest, records } = rekeyed!;
      expect(records["vault:header"]).toEqual(header);
      expect(digest).not.toBe(first!.digest);
      expect(await local.get([`snapshot:${other!.id}`])).toEqual(otherBefore);
    });

    it("recomputes the digest so the next identical take is still deduped", async () => {
      const { source, store, clock, vault } = await setup();
      await vault.addAccount(acc(SECRET, "A", "a"));
      await store.take(source, "daily");
      await vault.changePassword("new-password-1");
      await store.rekey(vault.vaultId, (await source.get(["vault:header"]))["vault:header"]);
      clock.advance(1000);
      expect(await store.take(source, "before-delete")).toBeNull();
    });

    it("rejects an invalid header for the same vault", async () => {
      const { source, store, vault } = await setup();
      await vault.addAccount(acc(SECRET, "A", "a"));
      const snap = await store.take(source, "daily");
      await expect(store.rekey(vault.vaultId, { vaultId: vault.vaultId })).rejects.toThrow();
      expect((await store.get(snap!.id))!.digest).toBe(snap!.digest);
    });

    it("rejects a header of another vault", async () => {
      const { source, store } = await setup();
      await store.take(source, "daily");
      await expect(store.rekey("someone-else", { vaultId: "x" })).rejects.toThrow();
      await expect(store.rekey("x", null)).rejects.toThrow();
    });
  });
});
