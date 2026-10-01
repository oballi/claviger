import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../src/testing";
import { moveVaultData } from "../src/vault/migrate";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

describe("moveVaultData", () => {
  it("moves only vault keys and leaves other data alone", async () => {
    const deps = makeDeps();
    await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    await deps.storage.set({ settings: { theme: "dark" } });
    const target = new MemoryStorage();
    const moved = await moveVaultData(deps.storage, target);
    expect(moved).toBe(2);
    expect([...target.data.keys()].sort()).toEqual(["vault:header", "vault:index"]);
    expect([...deps.storage.data.keys()]).toEqual(["settings"]);
    await Vault.unlockWithPassword({ ...deps, storage: target }, "pw");
  });

  it("refuses to overwrite a vault in the destination", async () => {
    const a = makeDeps();
    const b = makeDeps();
    await Vault.create(a, { password: "a", createRecoveryCode: false });
    await Vault.create(b, { password: "b", createRecoveryCode: false });
    expect(await asyncCodeOf(moveVaultData(a.storage, b.storage))).toBe("vault-exists");
    expect(a.storage.data.size).toBe(2);
  });

  it("keeps the source when the copy cannot be verified", async () => {
    const deps = makeDeps();
    await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    const lossy = new MemoryStorage();
    lossy.set = async () => {}; // writes nothing
    expect(await asyncCodeOf(moveVaultData(deps.storage, lossy))).toBe("vault-corrupt");
    expect(deps.storage.data.size).toBe(2);
  });

  it("cleans the destination and keeps the source when the write fails", async () => {
    const deps = makeDeps();
    await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    const target = new MemoryStorage();
    target.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    await expect(moveVaultData(deps.storage, target)).rejects.toThrow("QUOTA_BYTES");
    expect(target.data.size).toBe(0);
    expect(deps.storage.data.size).toBe(2);
  });

  it("does nothing when there is no vault", async () => {
    expect(await moveVaultData(new MemoryStorage(), new MemoryStorage())).toBe(0);
  });
});
