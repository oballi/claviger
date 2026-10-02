import { describe, expect, it, vi } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

const input = (issuer: string) =>
  normalizeAccountInput({
    secret: "JBSWY3DPEHPK3PX" + String.fromCharCode(65 + (issuer.charCodeAt(0) % 26)),
    issuer,
  });

async function setup() {
  const deps = makeDeps();
  const { vault } = await Vault.create(deps, { password: "pw-test-1", createRecoveryCode: false });
  const g = await vault.createGroup("Work");
  const h = await vault.createGroup("Home");
  const names: Record<string, string> = {};
  const add = async (issuer: string, groupId?: string) => {
    const a = await vault.addAccount(input(issuer));
    if (groupId) await vault.updateAccount(a.id, { groupId });
    names[a.id] = issuer;
    return a.id;
  };
  const order = async () => (await vault.listAccounts()).accounts.map((a) => names[a.id]);
  return { vault, deps, g, h, add, order };
}

describe("moveAccount", () => {
  it("moves an account into a group, right before the given account", async () => {
    const { vault, g, add, order } = await setup();
    await add("A", g.id);
    const b = await add("B", g.id);
    const c = await add("C");
    await vault.moveAccount(c, g.id, b);
    expect(await order()).toEqual(["A", "C", "B"]);
    expect((await vault.getAccount(c)).groupId).toBe(g.id);
  });

  it("appends to the end of the target group when beforeId is null", async () => {
    const { vault, g, add, order } = await setup();
    await add("A", g.id);
    await add("B", g.id);
    const c = await add("C");
    const d = await add("D");
    await vault.moveAccount(c, g.id, null);
    expect(await order()).toEqual(["A", "B", "C", "D"]);
    expect(d).toBeTruthy();
  });

  it("treats an unknown beforeId as the end of the group", async () => {
    const { vault, g, add, order } = await setup();
    await add("A", g.id);
    const c = await add("C");
    await vault.moveAccount(c, g.id, "nope");
    expect(await order()).toEqual(["A", "C"]);
    expect((await vault.getAccount(c)).groupId).toBe(g.id);
  });

  it("ignores a beforeId from another group and appends to the target group", async () => {
    const { vault, g, h, add, order } = await setup();
    await add("A", g.id);
    const x = await add("X", h.id);
    await add("B", g.id);
    const c = await add("C");
    await vault.moveAccount(c, g.id, x);
    expect(await order()).toEqual(["A", "X", "B", "C"]);
    expect((await vault.getAccount(c)).groupId).toBe(g.id);
  });

  it("keeps the position when beforeId is the account itself", async () => {
    const { vault, g, add, order } = await setup();
    await add("A");
    const b = await add("B");
    await add("C");
    await vault.moveAccount(b, g.id, b);
    expect(await order()).toEqual(["A", "B", "C"]);
    expect((await vault.getAccount(b)).groupId).toBe(g.id);
  });

  it("honours a pinned beforeId in the same group", async () => {
    const { vault, g, add, order } = await setup();
    const a = await add("A", g.id);
    await add("B", g.id);
    const c = await add("C");
    await vault.setPinned(a, true);
    await vault.moveAccount(c, g.id, a);
    expect(await order()).toEqual(["C", "A", "B"]);
  });

  it("moves out of a group when groupId is null and drops the field", async () => {
    const { vault, g, add } = await setup();
    const a = await add("A", g.id);
    await vault.moveAccount(a, null, null);
    expect((await vault.getAccount(a)).groupId).toBeUndefined();
  });

  it("only writes the index when the group does not change", async () => {
    const { vault, deps, g, add, order } = await setup();
    const a = await add("A", g.id);
    const b = await add("B", g.id);
    const before = deps.storage.data.get(`vault:acct:${b}`);
    await vault.moveAccount(b, g.id, a);
    expect(deps.storage.data.get(`vault:acct:${b}`)).toEqual(before);
    expect(await order()).toEqual(["B", "A"]);
  });

  it("only writes the index when a stale groupId moves to ungrouped", async () => {
    const { vault, deps, g, add } = await setup();
    const a = await add("A", g.id);
    await vault.rebuildIndex();
    const before = deps.storage.data.get(`vault:acct:${a}`);
    await vault.moveAccount(a, null, null);
    expect(deps.storage.data.get(`vault:acct:${a}`)).toEqual(before);
  });

  it("keeps the account pinned", async () => {
    const { vault, g, add } = await setup();
    const a = await add("A");
    await vault.setPinned(a, true);
    await vault.moveAccount(a, g.id, null);
    expect((await vault.listAccounts()).pinned).toEqual([a]);
  });

  it("rejects an unknown group and writes nothing", async () => {
    const { vault, deps, add } = await setup();
    const a = await add("A");
    const before = JSON.stringify([...deps.storage.data]);
    expect(await asyncCodeOf(vault.moveAccount(a, "nope", null))).toBe("group-not-found");
    expect(JSON.stringify([...deps.storage.data])).toBe(before);
  });

  it("rejects an unknown or deleted account with account-not-found", async () => {
    const { vault, deps, g, add } = await setup();
    const a = await add("A");
    expect(await asyncCodeOf(vault.moveAccount("missing", g.id, null))).toBe("account-not-found");
    await deps.storage.set({ [`vault:tomb:${a}`]: { deletedAt: 9e15 } });
    const before = JSON.stringify([...deps.storage.data]);
    expect(await asyncCodeOf(vault.moveAccount(a, g.id, null))).toBe("account-not-found");
    expect(JSON.stringify([...deps.storage.data])).toBe(before);
  });

  it("is atomic: when the single write fails the account keeps its group and position", async () => {
    const { vault, deps, g, add, order } = await setup();
    await add("A", g.id);
    const b = await add("B");
    deps.storage.failNextSet = new Error("boom");
    await expect(vault.moveAccount(b, g.id, null)).rejects.toThrow("boom");
    expect(await order()).toEqual(["A", "B"]);
    expect((await vault.getAccount(b)).groupId).toBeUndefined();
  });

  it("issues exactly one storage write for a group change and for a same-group move", async () => {
    const { vault, deps, g, add } = await setup();
    const a = await add("A", g.id);
    const b = await add("B");
    const spy = vi.spyOn(deps.storage, "set");
    await vault.moveAccount(b, g.id, a);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await vault.moveAccount(a, g.id, null);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
