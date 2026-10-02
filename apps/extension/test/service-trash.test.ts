import { TRASH_TTL_MS } from "@otp-vault/core";
import { TRASH_RETENTION_DAYS } from "@otp-vault/ui/views";
import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { memoryPlatform } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const DAY = 86_400_000;
const SECRET = "JBSWY3DPEHPK3PXP";
const add = (
  service: Awaited<ReturnType<typeof unlockedService>>["service"],
  issuer: string,
  secret = SECRET,
  label = "",
) => service.addAccount({ draft: { secret, issuer, label } });
const trashKeys = (storage: { data: Map<string, unknown> }) =>
  [...storage.data.keys()].filter((k) => k.startsWith("trash:"));

describe("recently deleted in the service", () => {
  it("shows a deleted account without its secret, with age and days left", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "Instagram", SECRET, "omer.balli");
    await service.deleteAccount(id);
    const items = await service.listTrash();
    expect(items).toEqual([
      {
        id,
        issuer: "Instagram",
        label: "omer.balli",
        deletedAt: p.clock.now(),
        expiresAt: p.clock.now() + TRASH_TTL_MS,
        ageDays: 0,
        daysLeft: 30,
      },
    ]);
    expect(TRASH_RETENTION_DAYS * DAY).toBe(TRASH_TTL_MS);
    expect(JSON.stringify(items)).not.toContain(SECRET);
  });

  it("counts calendar days and days left as time passes", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "Dropbox");
    await service.deleteAccount(id);
    p.clock.advance(DAY);
    expect((await service.listTrash())[0]).toMatchObject({ ageDays: 1, daysLeft: 29 });
    p.clock.advance(25 * DAY);
    expect((await service.listTrash())[0]).toMatchObject({ ageDays: 26, daysLeft: 4 });
  });

  it("never reports more than 30 days left when the clock went back", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "A");
    await service.deleteAccount(id);
    p.clock.advance(-5 * DAY);
    expect((await service.listTrash())[0]!.daysLeft).toBe(30);
  });

  it("stores the bin in storage.local only, sealed, outside the vault namespace", async () => {
    const sync = memoryPlatform();
    const syncService = new VaultService(sync);
    await syncService.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "sync",
    });
    const { id } = await add(syncService, "Synced", SECRET, "me@example.com");
    await syncService.deleteAccount(id);
    expect(trashKeys(sync.local)).toEqual([`trash:${id}`]);
    expect(trashKeys(sync.sync)).toEqual([]);
    const dump = JSON.stringify([...sync.local.data].filter(([k]) => k.startsWith("trash:")));
    for (const plain of [SECRET, "Synced", "me@example.com"]) expect(dump).not.toContain(plain);
  });

  it("restores under a fresh id with the same code, and returns the new id and name", async () => {
    const { service } = await unlockedService();
    const { id } = await add(service, "GitHub");
    const before = (await service.listAccounts()).accounts[0]!.code;
    await service.deleteAccount(id);
    const restored = await service.restoreTrash(id);
    expect(restored.name).toBe("GitHub");
    expect(restored.id).not.toBe(id);
    const now = (await service.listAccounts()).accounts;
    expect(now.map((a) => a.id)).toEqual([restored.id]);
    expect(now[0]!.code).toBe(before);
    expect(await service.listTrash()).toEqual([]);
  });

  it("purges one entry and empties the bin; live accounts stay", async () => {
    const { service } = await unlockedService();
    const a = await add(service, "A", "JBSWY3DPEHPK3PXA");
    const b = await add(service, "B", "JBSWY3DPEHPK3PXB");
    const keep = await add(service, "Keep", "JBSWY3DPEHPK3PXC");
    await service.deleteAccount(a.id);
    await service.deleteAccount(b.id);
    await service.purgeTrash(a.id);
    expect((await service.listTrash()).map((i) => i.id)).toEqual([b.id]);
    expect(await service.emptyTrash()).toEqual({ removed: 1 });
    expect(await service.listTrash()).toEqual([]);
    expect((await service.listAccounts()).accounts.map((x) => x.id)).toEqual([keep.id]);
  });

  it("refuses everything while locked", async () => {
    const { service } = await unlockedService();
    const { id } = await add(service, "A");
    await service.deleteAccount(id);
    await service.lock();
    expect(await codeOf(service.listTrash())).toBe("locked");
    expect(await codeOf(service.restoreTrash(id))).toBe("locked");
    expect(await codeOf(service.purgeTrash(id))).toBe("locked");
    expect(await codeOf(service.emptyTrash())).toBe("locked");
  });

  it("drops expired entries on unlock and on listTrash", async () => {
    const { service, p } = await unlockedService();
    const a = await add(service, "A", "JBSWY3DPEHPK3PXA");
    const b = await add(service, "B", "JBSWY3DPEHPK3PXB");
    await service.deleteAccount(a.id);
    p.clock.advance(TRASH_TTL_MS + 1);
    await service.lock();
    await service.unlock(PASSWORD);
    expect(trashKeys(p.local)).toEqual([]);
    await service.deleteAccount(b.id);
    p.clock.advance(TRASH_TTL_MS + 1);
    expect(await service.listTrash()).toEqual([]);
    expect(trashKeys(p.local)).toEqual([]);
  });

  it("leaves the bin out of snapshots and out of exports", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "Gone", "JBSWY3DPEHPK3PXD");
    await add(service, "Stays", "JBSWY3DPEHPK3PXE");
    await service.deleteAccount(id);
    for (const [key, value] of p.local.data) {
      if (!key.startsWith("snapshot:")) continue;
      expect(
        Object.keys((value as { records: object }).records).some((k) => k.startsWith("trash:")),
      ).toBe(false);
    }
    const { token } = await service.reauth(PASSWORD);
    const out = await service.exportVault(token, "otpauth");
    expect(out.content).toContain("Stays");
    expect(out.content).not.toContain("Gone");
  });

  it("keeps the bin readable after a password change", async () => {
    const { service } = await unlockedService();
    const { id } = await add(service, "A");
    await service.deleteAccount(id);
    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");
    expect((await service.restoreTrash(id)).name).toBe("A");
  });

  it("survives moving the vault to sync (the bin stays local)", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "A");
    await service.deleteAccount(id);
    const { token } = await service.reauth(PASSWORD);
    await service.setStorageArea(token, "sync");
    expect(trashKeys(p.sync)).toEqual([]);
    expect((await service.listTrash()).map((i) => i.id)).toEqual([id]);
    expect((await service.restoreTrash(id)).name).toBe("A");
  });

  it("clears the bin when the vault is deleted", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "A");
    await service.deleteAccount(id);
    expect(trashKeys(p.local)).toHaveLength(1);
    const { token } = await service.reauth(PASSWORD);
    await service.deleteVault(token);
    expect(trashKeys(p.local)).toEqual([]);
  });

  it("restoring after a snapshot restore reports the duplicate and keeps the entry", async () => {
    const { service } = await unlockedService();
    const { id } = await add(service, "Acme", "JBSWY3DPEHPK3PXA");
    await add(service, "Beta", "JBSWY3DPEHPK3PXB");
    await service.deleteAccount(id); // the before-delete copy still holds Acme
    const snap = (await service.listSnapshots()).find((s) => s.reason === "before-delete")!;
    const { token } = await service.reauth(PASSWORD);
    await service.restoreSnapshot(token, snap.id);
    expect(await codeOf(service.restoreTrash(id))).toBe("duplicate-account");
    expect((await service.listTrash()).map((i) => i.id)).toEqual([id]);
  });

  it("does not show another vault's bin after the vault was replaced", async () => {
    const { service, p } = await unlockedService();
    const { id } = await add(service, "Old");
    await service.deleteAccount(id);
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    await service.quarantineVault();
    const fresh = new VaultService(p);
    await fresh.setup({
      password: "second password 1",
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect(await fresh.listTrash()).toEqual([]);
    expect(await codeOf(fresh.restoreTrash(id))).toBe("trash-corrupt");
  });

  it("binds the bin when the key is loaded from the session cache", async () => {
    const { p } = await unlockedService();
    const fresh = new VaultService(p);
    const { id } = await add(fresh, "Cached");
    await fresh.deleteAccount(id);
    expect(trashKeys(p.local)).toEqual([`trash:${id}`]);
    expect((await fresh.listTrash()).map((i) => i.id)).toEqual([id]);
  });

  it("binds the bin after unlocking with the recovery code", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.lock();
    await service.unlockWithRecovery(recoveryCode!, "a brand new password");
    const { id } = await add(service, "Recovered");
    await service.deleteAccount(id);
    expect(trashKeys(p.local)).toEqual([`trash:${id}`]);
  });
});
