import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { accountKey, HEADER_KEY } from "../src/vault/format";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

describe("vault hardening", () => {
  it("refuses to delete an account record written by a newer version", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, {
      password: "pw-123456",
      createRecoveryCode: false,
    });
    const account = await vault.addAccount(normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP" }));
    const newer = { v: 2, iv: "AAAA", ct: "AAAA", updatedAt: 1 };
    deps.storage.data.set(accountKey(account.id), newer);
    expect(await asyncCodeOf(vault.deleteAccount(account.id))).toBe("unsupported-format");
    expect(deps.storage.data.get(accountKey(account.id))).toEqual(newer);
  });

  it("lets only one of two concurrent creates win", async () => {
    const deps = makeDeps();
    const results = await Promise.allSettled([
      Vault.create(deps, { password: "first-pass", createRecoveryCode: false }),
      Vault.create(deps, { password: "second-pass", createRecoveryCode: false }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      vault: Vault;
    }>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "vault-exists" });
    const header = deps.storage.data.get(HEADER_KEY) as { vaultId: string };
    expect(header.vaultId).toBe(fulfilled[0]!.value.vault.vaultId);
  });

  it("accepts a recovery code only once even when it is used concurrently", async () => {
    const deps = makeDeps();
    const { recoveryCode } = await Vault.create(deps, {
      password: "pw-123456",
      createRecoveryCode: true,
    });
    const results = await Promise.allSettled([
      Vault.unlockWithRecovery(deps, recoveryCode!, "new-pass-1"),
      Vault.unlockWithRecovery(deps, recoveryCode!, "new-pass-2"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      recoveryCode: string;
    }>[];
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatchObject({ code: "invalid-recovery-code" });
    await Vault.unlockWithRecovery(deps, ok[0]!.value.recoveryCode, "again-pass");
  });
});
