import { moveVaultData, Vault } from "@otp-vault/core";
import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { pauseOnce } from "./helpers/pause";
import { restartBrowser } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const clearsManualFlag = (arg: unknown) => Array.isArray(arg) && arg.includes("lock:manual");
const setsSettings = (arg: unknown) => typeof arg === "object" && arg !== null && "settings" in arg;

describe("locks that land during key storage", () => {
  it("keeps a lock that lands while setLockPolicy saves its settings", async () => {
    const { p, service } = await unlockedService();
    const { token } = await service.reauth(PASSWORD);
    const g = pauseOnce(p.local, "set", setsSettings);
    const pending = service.setLockPolicy(token, { kind: "never" });
    await g.hit;
    await service.lock();
    g.release();
    await pending;
    expect((await service.getState()).status).toBe("locked");
    expect(p.local.data.has("lock:persistedKey")).toBe(false);
    expect((await new VaultService(p).getState()).status).toBe("locked");
    expect((await new VaultService(restartBrowser(p)).getState()).status).toBe("locked");
  });

  it("keeps a lock that lands between the key writes of an unlock (never policy)", async () => {
    const { p, service } = await unlockedService(undefined, { kind: "never" });
    await service.lock();
    const g = pauseOnce(p.session, "remove", clearsManualFlag);
    const unlock = codeOf(service.unlock(PASSWORD));
    await g.hit;
    await service.lock();
    g.release();
    expect(await unlock).toBe("locked");
    expect((await service.getState()).status).toBe("locked");
    expect(p.local.data.has("lock:persistedKey")).toBe(false);
    expect((await new VaultService(restartBrowser(p)).getState()).status).toBe("locked");
  });
});

describe("interrupted storage move", () => {
  it("still opens the cached key when data moved but the setting did not", async () => {
    const { p, service } = await unlockedService(undefined, { kind: "never" });
    await service.addAccount({ draft: { secret: SECRET, issuer: "A" } });
    await moveVaultData(p.local, p.sync);
    const fresh = new VaultService(p);
    expect((await fresh.listAccounts()).accounts).toHaveLength(1);
    expect(p.local.data.has("lock:persistedKey")).toBe(true);
  });
});

describe("storage area target", () => {
  it("reports an already-set-up error when the target area holds a vault", async () => {
    const { p, service } = await unlockedService();
    await Vault.create(
      { storage: p.sync, random: p.random, clock: p.clock, kdf: p.kdf },
      { password: "another long password", createRecoveryCode: false },
    );
    const { token } = await service.reauth(PASSWORD);
    expect(await codeOf(service.setStorageArea(token, "sync"))).toBe("already-set-up");
  });
});

describe("newer-version records", () => {
  it("reports unsupported even while a key is cached", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ draft: { secret: SECRET, issuer: "A" } });
    p.local.data.set("vault:acct:00000000-0000-4000-8000-000000000000", {
      v: 2,
      iv: "x",
      ct: "y",
      updatedAt: 1,
    });
    expect((await service.getState()).status).toBe("unsupported");
  });
});
