import { describe, expect, it } from "vitest";
import { moveVaultData, normalizeAccountInput, Vault } from "../src";
import { MemoryStorage } from "../src/testing";
import { makeDeps } from "./helpers/vault";

const input = (issuer = "A", secret = "JBSWY3DPEHPK3PXP") =>
  normalizeAccountInput({ secret, issuer });

async function setup() {
  const deps = makeDeps();
  const { vault } = await Vault.create(deps, { password: "pw-test-1", createRecoveryCode: false });
  const a = await vault.addAccount(input());
  return { vault, deps, a };
}

describe("site memory", () => {
  it("remembers, reads back and survives a re-open", async () => {
    const { vault, deps, a } = await setup();
    await vault.rememberSite("example.com", a.id);
    const again = await Vault.fromKey(deps, vault.exportKey());
    expect(await again.getSiteMemory()).toEqual({ "example.com": a.id });
  });

  it("stores no plaintext domain", async () => {
    const { vault, deps, a } = await setup();
    await vault.rememberSite("secret-bank.example", a.id);
    expect(JSON.stringify(await deps.storage.get())).not.toContain("secret-bank");
  });

  it("drops entries of deleted accounts on read and on write", async () => {
    const { vault, a } = await setup();
    const b = await vault.addAccount(input("B", "GEZDGNBVGY3TQOJQ"));
    await vault.rememberSite("example.com", a.id);
    await vault.deleteAccount(a.id);
    expect(await vault.getSiteMemory()).toEqual({});
    await vault.rememberSite("other.example", b.id);
    expect(await vault.getSiteMemory()).toEqual({ "other.example": b.id });
    expect(await vault.getSiteMemory(new Set([a.id, b.id]))).toEqual({ "other.example": b.id });
  });

  it("uses the supplied live ids instead of listing accounts", async () => {
    const { vault, a } = await setup();
    await vault.rememberSite("example.com", a.id);
    expect(await vault.getSiteMemory(new Set())).toEqual({});
  });

  it("treats a damaged record as empty and keeps the vault usable", async () => {
    const { vault, deps, a } = await setup();
    await deps.storage.set({ "vault:sitemem": { v: 1, iv: "x", ct: "y", updatedAt: 1 } });
    expect(await vault.getSiteMemory()).toEqual({});
    expect((await vault.listAccounts()).unreadable).toEqual([]);
    await vault.rememberSite("example.com", a.id);
    expect(await vault.getSiteMemory()).toEqual({ "example.com": a.id });
  });

  it("does not overwrite a record from a newer version", async () => {
    const { vault, deps, a } = await setup();
    const newer = { v: 2, iv: "x", ct: "y", updatedAt: 1 };
    await deps.storage.set({ "vault:sitemem": newer });
    await vault.rememberSite("example.com", a.id);
    expect((await deps.storage.get(["vault:sitemem"]))["vault:sitemem"]).toEqual(newer);
    expect(await vault.getSiteMemory()).toEqual({});
  });

  it("caps the memory at 500 entries, dropping the oldest", async () => {
    const { vault, a } = await setup();
    for (let i = 0; i < 501; i++) await vault.rememberSite(`d${i}.example`, a.id);
    const memory = await vault.getSiteMemory();
    expect(Object.keys(memory)).toHaveLength(500);
    expect(memory["d0.example"]).toBeUndefined();
    expect(memory["d500.example"]).toBe(a.id);
  }, 60_000);

  it("re-remembering a domain moves it to the newest slot", async () => {
    const { vault, a } = await setup();
    await vault.rememberSite("a.example", a.id);
    await vault.rememberSite("b.example", a.id);
    await vault.rememberSite("a.example", a.id);
    expect(Object.keys(await vault.getSiteMemory())).toEqual(["b.example", "a.example"]);
  });

  it("moves with the vault and clears on request", async () => {
    const { vault, deps, a } = await setup();
    await vault.rememberSite("example.com", a.id);
    const target = new MemoryStorage();
    await moveVaultData(deps.storage, target);
    const moved = await Vault.fromKey({ ...deps, storage: target }, vault.exportKey());
    expect(await moved.getSiteMemory()).toEqual({ "example.com": a.id });
    await moved.clearSiteMemory();
    expect(await target.get(["vault:sitemem"])).toEqual({});
  });

  it("leaves older readers unaffected by the key", async () => {
    const { vault, deps, a } = await setup();
    await vault.rememberSite("example.com", a.id);
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([a.id]);
    expect((await vault.listAccounts()).unreadable).toEqual([]);
    expect(await Vault.inspect(deps.storage)).toMatchObject({ status: "ok", accountCount: 1 });
    const again = await Vault.fromKey(deps, vault.exportKey());
    expect((await again.listAccounts()).accounts).toHaveLength(1);
  });
});
