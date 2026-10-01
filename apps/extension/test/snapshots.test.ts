import { normalizeAccountInput, Vault, webRandom } from "@otp-vault/core";
import { FakeClock, FAST_KDF, MemoryStorage } from "@otp-vault/core/testing";
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

  it("skips a copy identical to the newest one", async () => {
    const { source, store, clock } = await setup();
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

  it("keeps the newest non-empty copy when pruning", async () => {
    const { source, store, clock, vault } = await setup();
    await vault.addAccount(acc(SECRET, "Acme", "a"));
    clock.advance(1000);
    const nonEmpty = await store.take(source, "daily");
    expect(nonEmpty!.accountCount).toBe(1);
    // Emptying the vault makes every later copy empty; they must not evict the non-empty one.
    const { accounts } = await vault.listAccounts();
    for (const a of accounts) await vault.deleteAccount(a.id);
    for (let i = 0; i < MAX_SNAPSHOTS + 2; i++) {
      await source.set({ "vault:test-noise": i });
      clock.advance(1000);
      await store.take(source, "before-delete");
    }
    const list = await store.list();
    expect(list.some((s) => s.id === nonEmpty!.id)).toBe(true);
    expect(list).toHaveLength(MAX_SNAPSHOTS + 1);
  });

  it("takes a daily copy only after a day, or when the clock went back", async () => {
    const { source, store, clock, vault } = await setup();
    await store.takeDaily(source);
    await vault.addAccount(acc(SECRET, "B", "b"));
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
    await store.take(source, "daily");
    await vault.addAccount(acc(SECRET, "A", "a"));
    clock.advance(1000);
    local.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    const snap = await store.take(source, "before-import");
    expect(snap).not.toBeNull();
    expect((await store.list()).map((s) => s.id)).toEqual([snap!.id]);
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
      await Vault.create(
        { storage: otherSource, random: webRandom, clock, kdf: FAST_KDF },
        { password: "other-pw-1234", createRecoveryCode: false },
      );
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
      await store.take(source, "daily");
      await vault.changePassword("new-password-1");
      await store.rekey(vault.vaultId, (await source.get(["vault:header"]))["vault:header"]);
      clock.advance(1000);
      expect(await store.take(source, "before-delete")).toBeNull();
    });

    it("rejects a header of another vault", async () => {
      const { source, store } = await setup();
      await store.take(source, "daily");
      await expect(store.rekey("someone-else", { vaultId: "x" })).rejects.toThrow();
      await expect(store.rekey("x", null)).rejects.toThrow();
    });
  });
});
