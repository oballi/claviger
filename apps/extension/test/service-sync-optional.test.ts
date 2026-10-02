import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { SETTINGS_KEY } from "../src/background/settings";
import { SNAPSHOT_PREFIX } from "../src/background/snapshots";
import { memoryPlatform, restartBrowser } from "./helpers/platform";
import { PASSWORD } from "./helpers/service";

const SETUP = {
  password: PASSWORD,
  createRecoveryCode: false,
  lockPolicy: { kind: "browser-close" } as const,
  storageArea: "local" as const,
};

const snapshotKeys = async (p: { local: { get(): Promise<Record<string, unknown>> } }) =>
  Object.keys(await p.local.get()).filter((k) => k.startsWith(SNAPSHOT_PREFIX));

describe("a platform without a sync area", () => {
  it("sets up, locks and unlocks in local storage", async () => {
    const service = new VaultService(memoryPlatform({ sync: false }));
    expect((await service.getState()).status).toBe("no-vault");
    await service.setup(SETUP);
    expect(await service.getState()).toMatchObject({ status: "unlocked", storageArea: "local" });
    await service.lock();
    await service.unlock(PASSWORD);
    expect((await service.getState()).status).toBe("unlocked");
  });

  it("rejects moving the vault to sync and keeps the token usable and no snapshot", async () => {
    const p = memoryPlatform({ sync: false });
    const service = new VaultService(p);
    await service.setup(SETUP);
    const before = await snapshotKeys(p);
    const { token } = await service.reauth(PASSWORD);
    await expect(service.setStorageArea(token, "sync")).rejects.toMatchObject({
      code: "storage-area-unavailable",
    });
    expect(await snapshotKeys(p)).toEqual(before);
    await expect(service.setStorageArea(token, "local")).resolves.toBeUndefined();
    expect((await service.getState()).storageArea).toBe("local");
  });

  it("rejects a sync setup request instead of writing nowhere", async () => {
    const service = new VaultService(memoryPlatform({ sync: false }));
    await expect(service.setup({ ...SETUP, storageArea: "sync" })).rejects.toMatchObject({
      code: "storage-area-unavailable",
    });
    expect((await service.getState()).status).toBe("no-vault");
  });

  it("does not look for a vault in the missing sync area", async () => {
    const service = new VaultService(memoryPlatform({ sync: false }));
    await service.setup(SETUP);
    await expect(service.setup(SETUP)).rejects.toMatchObject({ code: "already-set-up" });
  });

  it("treats a persisted sync setting as local", async () => {
    const p = memoryPlatform({ sync: false });
    await new VaultService(p).setup(SETUP);
    const stored = (await p.local.get([SETTINGS_KEY]))[SETTINGS_KEY] as object;
    await p.local.set({ [SETTINGS_KEY]: { ...stored, storageArea: "sync" } });
    const service = new VaultService(restartBrowser(p));
    expect(await service.getState()).toMatchObject({ status: "locked", storageArea: "local" });
    await service.unlock(PASSWORD);
    expect((await service.storageUsage()).area).toBe("local");
    await expect(service.quarantineVault()).rejects.toMatchObject({ code: "invalid-request" });
  });
});
