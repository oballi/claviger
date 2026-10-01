import { describe, expect, it } from "vitest";
import { webRandom } from "../src/ports";
import { HEADER_KEY, INDEX_KEY } from "../src/vault/format";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

describe("Vault lifecycle", () => {
  it("creates a vault with header and encrypted index", async () => {
    const deps = makeDeps();
    expect(await Vault.exists(deps.storage)).toBe(false);
    const { vault, recoveryCode } = await Vault.create(deps, {
      password: "pw-123456",
      createRecoveryCode: false,
    });
    expect(recoveryCode).toBeNull();
    expect(await Vault.exists(deps.storage)).toBe(true);
    expect(deps.storage.data.get(HEADER_KEY)).toMatchObject({ format: 1, vaultId: vault.vaultId });
    expect(deps.storage.data.get(INDEX_KEY)).toMatchObject({ v: 1 });
    expect(JSON.stringify([...deps.storage.data])).not.toContain("pw-123456");
  });

  it("optionally creates a recovery code", async () => {
    const deps = makeDeps();
    const { recoveryCode } = await Vault.create(deps, {
      password: "pw-123456",
      createRecoveryCode: true,
    });
    expect(recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    const header = deps.storage.data.get(HEADER_KEY) as { keyslots: { kind: string }[] };
    expect(header.keyslots.map((s) => s.kind)).toEqual(["password", "recovery"]);
  });

  it("refuses to overwrite an existing vault", async () => {
    const deps = makeDeps();
    await Vault.create(deps, { password: "a", createRecoveryCode: false });
    expect(
      await asyncCodeOf(Vault.create(deps, { password: "b", createRecoveryCode: false })),
    ).toBe("vault-exists");
  });

  it("unlocks with the right password only", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, {
      password: "pw-123456",
      createRecoveryCode: false,
    });
    const reopened = await Vault.unlockWithPassword(deps, "pw-123456");
    expect(reopened.vaultId).toBe(vault.vaultId);
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "nope"))).toBe("wrong-password");
  });

  it("reports a missing or corrupt vault", async () => {
    const deps = makeDeps();
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "x"))).toBe("vault-not-found");
    await deps.storage.set({ [HEADER_KEY]: { format: 1 } });
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "x"))).toBe("vault-corrupt");
    await deps.storage.set({ [HEADER_KEY]: { format: "1" } });
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "x"))).toBe("vault-corrupt");
  });

  it("reports a vault from a newer version as unsupported, not corrupt", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    const header = deps.storage.data.get(HEADER_KEY) as Record<string, unknown>;
    deps.storage.data.set(HEADER_KEY, { ...header, format: 2, somethingNew: true });
    expect(await asyncCodeOf(Vault.unlockWithPassword(deps, "pw"))).toBe("unsupported-format");
    expect(await asyncCodeOf(Vault.fromKey(deps, vault.exportKey()))).toBe("unsupported-format");
  });

  it("restores from an exported key and rejects foreign keys", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    const restored = await Vault.fromKey(deps, vault.exportKey());
    expect(restored.vaultId).toBe(vault.vaultId);
    expect(await asyncCodeOf(Vault.fromKey(deps, webRandom.bytes(32)))).toBe("wrong-password");
  });

  it("exportKey returns a copy", async () => {
    const deps = makeDeps();
    const { vault } = await Vault.create(deps, { password: "pw", createRecoveryCode: false });
    const k = vault.exportKey();
    k.fill(0);
    expect(vault.exportKey().some((b) => b !== 0)).toBe(true);
  });
});
