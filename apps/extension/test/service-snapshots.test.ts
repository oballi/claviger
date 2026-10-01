import { Vault } from "@otp-vault/core";
import { MemoryStorage } from "@otp-vault/core/testing";
import { describe, expect, it, vi } from "vitest";
import { DAY_MS, recordsStorage, SnapshotStore } from "../src/background/snapshots";
import { memoryPlatform, type TestPlatform } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const URI = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const snapKeys = async (p: ReturnType<typeof memoryPlatform>) =>
  Object.keys(await p.local.get()).filter((k) => k.startsWith("snapshot:"));

describe("service snapshots", () => {
  it("takes a copy before deleting an account", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    p.clock.advance(1000);
    await service.deleteAccount(id);
    const list = await service.listSnapshots();
    expect(list.map((s) => s.reason)).toContain("before-delete");
    expect(list.find((s) => s.reason === "before-delete")!.accountCount).toBe(1);
    expect(list.every((s) => s.sameVault)).toBe(true);
  });

  it("takes a copy before an import commit", async () => {
    const { service } = await unlockedService();
    const preview = await service.importPreview(URI);
    if (preview.status !== "ok") throw new Error("preview");
    await service.importCommit(preview.previewId, [0]);
    expect((await service.listSnapshots()).map((s) => s.reason)).toContain("before-import");
  });

  it("takes a copy before a rebuild and before an area move", async () => {
    const { service } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.rebuildIndex();
    expect((await service.listSnapshots()).map((s) => s.reason)).toContain("before-rebuild");
    await service.addAccount({ uri: URI.replace("JBSWY3DPEHPK3PXP", "GEZDGNBVGY3TQOJQ") });
    const { token } = await service.reauth(PASSWORD);
    await service.setStorageArea(token, "sync");
    expect((await service.listSnapshots()).map((s) => s.reason)).toContain("before-move");
  });

  it("takes a copy before a recovery unlock", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.lock();
    await service.unlockWithRecovery(recoveryCode!, "another password 1");
    const reasons = Object.entries(await p.local.get())
      .filter(([k]) => k.startsWith("snapshot:"))
      .map(([, v]) => (v as { reason: string }).reason);
    expect(reasons).toContain("before-recovery");
  });

  it("still deletes when the snapshot cannot be stored", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    p.local.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    // No previous snapshot exists, so the retry has nothing to drop and the snapshot fails.
    await p.local.remove(await snapKeys(p));
    await expect(service.deleteAccount(id)).resolves.toBeUndefined();
    expect((await service.listAccounts()).accounts).toHaveLength(0);
  });

  it("takes a daily copy from getState at most once per hour, even while locked", async () => {
    const { service, p } = await unlockedService();
    await service.lock();
    await service.getState();
    const first = (await snapKeys(p)).length;
    expect(first).toBeGreaterThanOrEqual(1);
    p.clock.advance(DAY_MS);
    await service.getState(); // a day later, but the content is unchanged
    expect((await snapKeys(p)).length).toBe(first); // same content -> deduped
  });

  it("purges old tombstones on unlock and survives a purge failure", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    await service.deleteAccount(id);
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("vault:tomb:"))).toBe(true);
    await service.lock();
    p.clock.advance(91 * DAY_MS);
    await service.unlock(PASSWORD);
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("vault:tomb:"))).toBe(false);

    await service.lock();
    vi.spyOn(Vault.prototype, "purgeTombstones").mockRejectedValueOnce(new Error("boom"));
    await expect(service.unlock(PASSWORD)).resolves.toBeUndefined();
  });

  it("deleteVault removes snapshots and quarantine", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.getState();
    await p.local.set({ "quarantine:1-x": { v: 1, createdAt: 1, records: {} } });
    const { token } = await service.reauth(PASSWORD);
    await service.deleteVault(token);
    const keys = Object.keys(await p.local.get());
    expect(keys.filter((k) => k.startsWith("snapshot:") || k.startsWith("quarantine:"))).toEqual(
      [],
    );
  });

  it("listSnapshots needs an unlocked vault", async () => {
    const { service } = await unlockedService();
    await service.lock();
    await expect(service.listSnapshots()).rejects.toMatchObject({ code: "locked" });
  });
});

const deps = (p: TestPlatform, storage: MemoryStorage | ReturnType<typeof recordsStorage>) => ({
  storage,
  random: p.random,
  clock: p.clock,
  kdf: p.kdf,
});

async function foreignSnapshot(p: TestPlatform) {
  const other = new MemoryStorage();
  await Vault.create(deps(p, other), { password: "other-vault-pw", createRecoveryCode: false });
  const snap = await new SnapshotStore(p.local, p.clock, p.random).take(other, "daily");
  return snap!;
}

describe("snapshot revocation (keyslot changes)", () => {
  it("old password no longer opens any same-vault copy after changePassword", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.getState();
    const foreign = await foreignSnapshot(p);
    const sameVault = (await service.listSnapshots()).filter((s) => s.sameVault);
    expect(sameVault.length).toBeGreaterThan(0);

    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");

    const store = new SnapshotStore(p.local, p.clock, p.random);
    for (const info of sameVault) {
      const snap = (await store.get(info.id))!;
      await expect(
        Vault.unlockWithPassword(deps(p, recordsStorage(snap.records)), PASSWORD),
      ).rejects.toMatchObject({ code: "wrong-password" });
      // The new password still opens the copy.
      await Vault.unlockWithPassword(deps(p, recordsStorage(snap.records)), "a brand new password");
    }
    expect(await store.get(foreign.id)).toEqual(foreign);
  });

  it("old recovery code no longer opens any same-vault copy after createRecoveryCode", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.getState();
    const foreign = await foreignSnapshot(p);
    const sameVault = (await service.listSnapshots()).filter((s) => s.sameVault);
    expect(sameVault.length).toBeGreaterThan(0);

    const { token } = await service.reauth(PASSWORD);
    const { recoveryCode: next } = await service.createRecoveryCode(token);

    const store = new SnapshotStore(p.local, p.clock, p.random);
    for (const info of sameVault) {
      const snap = (await store.get(info.id))!;
      expect(
        await codeOf(
          Vault.unlockWithRecovery(
            deps(p, recordsStorage(snap.records)),
            recoveryCode!,
            "x".repeat(12),
          ),
        ),
      ).toBe("invalid-recovery-code");
      expect(
        await codeOf(
          Vault.unlockWithRecovery(deps(p, recordsStorage(snap.records)), next, "x".repeat(12)),
        ),
      ).not.toBe("invalid-recovery-code");
    }
    expect(await store.get(foreign.id)).toEqual(foreign);
  });

  it("recovery unlock revokes the old password in copies", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.getState();
    await service.lock();
    await service.unlockWithRecovery(recoveryCode!, "another password 1");
    const store = new SnapshotStore(p.local, p.clock, p.random);
    const copies = await store.list();
    expect(copies.length).toBeGreaterThan(0);
    for (const snap of copies) {
      await expect(
        Vault.unlockWithPassword(deps(p, recordsStorage(snap.records)), PASSWORD),
      ).rejects.toMatchObject({ code: "wrong-password" });
    }
  });

  it("deletes same-vault copies when the rekey fails, leaving other vaults alone", async () => {
    const { service, p } = await unlockedService();
    await service.getState();
    const foreign = await foreignSnapshot(p);
    vi.spyOn(SnapshotStore.prototype, "rekey").mockRejectedValueOnce(new Error("boom"));
    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");
    const left = await new SnapshotStore(p.local, p.clock, p.random).list();
    expect(left.map((s) => s.id)).toEqual([foreign.id]);
  });
});
