import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { HEADER_KEY } from "../src/vault/format";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("password management", () => {
  it("verifies the current password", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "old-pass", createRecoveryCode: false });
    expect(await vault.verifyPassword("old-pass")).toBe(true);
    expect(await vault.verifyPassword("nope")).toBe(false);
  });

  it("changes the password without re-encrypting accounts", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "old-pass", createRecoveryCode: true });
    const account = await vault.addAccount(normalizeAccountInput({ secret: SECRET, issuer: "A" }));
    const recordBefore = deps.storage.data.get(`vault:acct:${account.id}`);
    await vault.changePassword("new-pass");
    expect(deps.storage.data.get(`vault:acct:${account.id}`)).toEqual(recordBefore);
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "old-pass"))).toBe("wrong-password");
    const reopened = await Vault.unlockWithPassword(deps, "new-pass");
    expect((await reopened.listAccounts()).accounts).toEqual([account]);
    expect(reopened.hasRecoveryCode()).toBe(true);
  });
});

describe("recovery codes", () => {
  it("unlocks with the recovery code, sets a new password and rotates the code", async () => {
    const deps = makeDeps();
    const { vault, recoveryCode } = await Vault.create(deps, {
      password: "forgotten",
      createRecoveryCode: true,
    });
    await vault.addAccount(normalizeAccountInput({ secret: SECRET }));
    const result = await Vault.unlockWithRecovery(deps, recoveryCode!, "brand-new");
    expect((await result.vault.listAccounts()).accounts).toHaveLength(1);
    expect(result.recoveryCode).not.toBe(recoveryCode);
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "forgotten"))).toBe("wrong-password");
    await Vault.unlockWithPassword(deps, "brand-new");
    expect(await asyncCodeOf(Vault.unlockWithRecovery(deps, recoveryCode!, "x"))).toBe(
      "invalid-recovery-code",
    );
    await Vault.unlockWithRecovery(deps, result.recoveryCode, "again");
  });

  it("rejects wrong or malformed codes and vaults without a recovery slot", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    const fake = "0000-0000-0000-0000-0000-0000-0000-0000";
    expect(await asyncCodeOf(Vault.unlockWithRecovery(deps, fake, "x"))).toBe(
      "invalid-recovery-code",
    );
    const code = await vault.createRecoveryCode();
    expect(await asyncCodeOf(Vault.unlockWithRecovery(deps, fake, "x"))).toBe(
      "invalid-recovery-code",
    );
    expect(await asyncCodeOf(Vault.unlockWithRecovery(deps, "garbage", "x"))).toBe(
      "invalid-recovery-code",
    );
    expect(code).toMatch(/-/);
  });

  it("creates, replaces and removes the recovery slot", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    expect(vault.hasRecoveryCode()).toBe(false);
    const first = await vault.createRecoveryCode();
    const second = await vault.createRecoveryCode();
    const header = deps.storage.data.get(HEADER_KEY) as { keyslots: { kind: string }[] };
    expect(header.keyslots.filter((s) => s.kind === "recovery")).toHaveLength(1);
    expect(await asyncCodeOf(Vault.unlockWithRecovery(deps, first, "x"))).toBe(
      "invalid-recovery-code",
    );
    await vault.removeRecoveryCode();
    expect(vault.hasRecoveryCode()).toBe(false);
    expect(await asyncCodeOf(Vault.unlockWithRecovery(deps, second, "x"))).toBe(
      "invalid-recovery-code",
    );
  });
});

describe("atomic header writes", () => {
  it("unlockWithRecovery writes the header exactly once", async () => {
    const deps = makeDeps();
    const { recoveryCode } = await Vault.create(deps, { password: "pw", createRecoveryCode: true });
    const original = deps.storage.set.bind(deps.storage);
    let calls = 0;
    deps.storage.set = async (items) => {
      calls++;
      return original(items);
    };
    await Vault.unlockWithRecovery(deps, recoveryCode!, "new");
    expect(calls).toBe(1);
  });

  it("leaves nothing half-applied when the write fails", async () => {
    const deps = makeDeps();
    const { recoveryCode } = await Vault.create(deps, { password: "pw", createRecoveryCode: true });
    const before = structuredClone(deps.storage.data.get(HEADER_KEY));
    deps.storage.failNextSet = new Error("x");
    await expect(Vault.unlockWithRecovery(deps, recoveryCode!, "new")).rejects.toThrow("x");
    expect(deps.storage.data.get(HEADER_KEY)).toEqual(before);
    await Vault.unlockWithPassword(deps, "pw");
    await Vault.unlockWithRecovery(deps, recoveryCode!, "new");
  });

  it("refuses to write slots when the stored header belongs to another vault", async () => {
    const deps = makeDeps();
    const other = makeDeps();
    const { vault } = await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    await Vault.create(other, { password: "other", createRecoveryCode: false });
    deps.storage.data.set(HEADER_KEY, other.storage.data.get(HEADER_KEY));
    expect(await asyncCodeOf(vault.changePassword("x"))).toBe("vault-corrupt");
  });
});
