import { describe, expect, it } from "vitest";
import { accountSchema, normalizeAccountInput } from "../src/account/account";
import { indexSchema } from "../src/vault/format";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

const input = (issuer: string, secret = "JBSWY3DPEHPK3PXP") =>
  normalizeAccountInput({ secret, issuer });

async function setup() {
  const deps = makeDeps();
  const { vault } = await Vault.create(deps, { password: "pw-test-1", createRecoveryCode: false });
  return { vault, deps };
}

describe("group list", () => {
  it("creates groups in order and keeps them across a re-open", async () => {
    const { vault, deps } = await setup();
    const work = await vault.createGroup("  Work ");
    const home = await vault.createGroup("Home");
    expect(work.name).toBe("Work");
    expect(work.id).toMatch(/^[0-9a-f]{12}$/);
    const again = await Vault.fromKey(deps, vault.exportKey());
    expect((await again.listAccounts()).groups).toEqual([work, home]);
  });

  it("rejects bad names with invalid-group-name", async () => {
    const { vault } = await setup();
    for (const bad of ["", "   ", "x".repeat(41), "bad\uD800name"])
      expect(await asyncCodeOf(vault.createGroup(bad))).toBe("invalid-group-name");
    await expect(vault.createGroup("x".repeat(40))).resolves.toBeTruthy();
  });

  it("rejects control and bidi characters but allows ZWJ/ZWNJ", async () => {
    const { vault } = await setup();
    for (const bad of ["a\u0000b", "a\u0007b", "a‮b", "a⁦b", "a⁩b", "a‪b"])
      expect(await asyncCodeOf(vault.createGroup(bad))).toBe("invalid-group-name");
    await expect(vault.createGroup("a‍b")).resolves.toBeTruthy();
    await expect(vault.createGroup("a‌b")).resolves.toBeTruthy();
  });

  it("counts code points, not UTF-16 units", async () => {
    const { vault } = await setup();
    await expect(vault.createGroup("\u{1F600}".repeat(40))).resolves.toBeTruthy();
    expect(await asyncCodeOf(vault.createGroup("\u{1F600}".repeat(41)))).toBe("invalid-group-name");
  });

  it("treats names as equal regardless of case and Unicode normalization", async () => {
    const { vault } = await setup();
    await vault.createGroup("Work");
    expect(await asyncCodeOf(vault.createGroup("wORK"))).toBe("duplicate-group");
    await vault.createGroup("café");
    expect(await asyncCodeOf(vault.createGroup("café"))).toBe("duplicate-group");
  });

  it("folds the Turkish dotted capital I", async () => {
    const { vault } = await setup();
    await vault.createGroup("İş");
    expect(await asyncCodeOf(vault.createGroup("iş"))).toBe("duplicate-group");
    await vault.createGroup("ŞİRKET");
    expect(await asyncCodeOf(vault.createGroup("şirket"))).toBe("duplicate-group");
  });

  it("renames, allows a case-only change of its own name, and rejects a clash", async () => {
    const { vault } = await setup();
    const a = await vault.createGroup("Work");
    await vault.createGroup("Home");
    await vault.renameGroup(a.id, "WORK");
    expect((await vault.listAccounts()).groups[0]!.name).toBe("WORK");
    expect(await asyncCodeOf(vault.renameGroup(a.id, "home"))).toBe("duplicate-group");
    expect(await asyncCodeOf(vault.renameGroup("nope", "X"))).toBe("group-not-found");
  });

  it("caps the group count at 30", async () => {
    const { vault } = await setup();
    for (let i = 0; i < 30; i++) await vault.createGroup(`g${i}`);
    expect(await asyncCodeOf(vault.createGroup("one more"))).toBe("group-limit");
  });

  it("caps the stored size so the index stays inside the sync item quota", async () => {
    const { vault } = await setup();
    let created = 0;
    for (;;) {
      const name = `${String(created).padStart(2, "0")}${"ü".repeat(38)}`;
      const code = await asyncCodeOf(vault.createGroup(name));
      if (code) {
        expect(code).toBe("group-limit");
        break;
      }
      created++;
    }
    expect(created).toBeGreaterThan(8);
    expect(created).toBeLessThan(30);
  });

  it("reorders; unknown ids are ignored and missing ones keep their place at the end", async () => {
    const { vault } = await setup();
    const a = await vault.createGroup("A");
    const b = await vault.createGroup("B");
    const c = await vault.createGroup("C");
    await vault.reorderGroups([c.id, "nope", a.id, c.id]);
    expect((await vault.listAccounts()).groups.map((g) => g.name)).toEqual(["C", "A", "B"]);
    expect(b.id).toBeTruthy();
  });
});

describe("account membership", () => {
  it("assigns, keeps and clears a group through updateAccount", async () => {
    const { vault } = await setup();
    const g = await vault.createGroup("Work");
    const a = await vault.addAccount(input("GitHub"));
    await vault.updateAccount(a.id, { groupId: g.id });
    await vault.updateAccount(a.id, { label: "renamed" });
    expect((await vault.getAccount(a.id)).groupId).toBe(g.id);
    expect((await vault.listAccounts()).accounts[0]!.groupId).toBe(g.id);
    await vault.updateAccount(a.id, { groupId: null });
    expect((await vault.getAccount(a.id)).groupId).toBeUndefined();
  });

  it("rejects an unknown group", async () => {
    const { vault } = await setup();
    const a = await vault.addAccount(input("GitHub"));
    expect(await asyncCodeOf(vault.updateAccount(a.id, { groupId: "nope" }))).toBe(
      "group-not-found",
    );
  });

  it("keeps the group over an HOTP increment", async () => {
    const { vault } = await setup();
    const g = await vault.createGroup("Work");
    const a = await vault.addAccount(
      normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP", type: "hotp", issuer: "H" }),
    );
    await vault.updateAccount(a.id, { groupId: g.id });
    await vault.incrementHotp(a.id);
    expect((await vault.getAccount(a.id)).groupId).toBe(g.id);
  });

  it("deletes a group, clears only its members and leaves other groups alone", async () => {
    const { vault, deps } = await setup();
    const work = await vault.createGroup("Work");
    const home = await vault.createGroup("Home");
    const a = await vault.addAccount(input("A", "JBSWY3DPEHPK3PXA"));
    const b = await vault.addAccount(input("B", "JBSWY3DPEHPK3PXB"));
    const c = await vault.addAccount(input("C", "JBSWY3DPEHPK3PXC"));
    await vault.updateAccount(a.id, { groupId: work.id });
    await vault.updateAccount(b.id, { groupId: home.id });
    const sets: number[] = [];
    const original = deps.storage.set.bind(deps.storage);
    deps.storage.set = async (items) => {
      sets.push(Object.keys(items).length);
      return original(items);
    };
    await vault.deleteGroup(work.id);
    expect(sets).toEqual([2]);
    const listing = await vault.listAccounts();
    expect(listing.groups).toEqual([home]);
    expect(listing.accounts.map((x) => [x.issuer, x.groupId])).toEqual([
      ["A", undefined],
      ["B", home.id],
      ["C", undefined],
    ]);
    expect((await vault.getAccount(a.id)).groupId).toBeUndefined();
    expect(c.id).toBeTruthy();
    expect(await asyncCodeOf(vault.deleteGroup(work.id))).toBe("group-not-found");
  });

  it("survives account deletion without losing the group list", async () => {
    const { vault } = await setup();
    const g = await vault.createGroup("Work");
    const a = await vault.addAccount(input("A"));
    await vault.deleteAccount(a.id);
    expect((await vault.listAccounts()).groups).toEqual([g]);
  });
});

describe("older shapes", () => {
  const legacy = {
    id: "a1",
    type: "totp",
    secret: "JBSWY3DPEHPK3PXP",
    issuer: "X",
    label: "",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 0,
    domains: [],
    createdAt: 1,
    updatedAt: 1,
  };

  it("reads a record and an index written before groups existed", () => {
    expect(accountSchema.parse(legacy).groupId).toBeUndefined();
    expect(indexSchema.parse({ order: [], pinned: [], updatedAt: 1 }).groups).toBeUndefined();
  });

  it("lets an older reader (schema without the new fields) parse new data", () => {
    const old = accountSchema.omit({ groupId: true }).parse({ ...legacy, groupId: "abc" });
    expect("groupId" in old).toBe(false);
    const idx = indexSchema.omit({ groups: true }).parse({
      order: [],
      pinned: [],
      updatedAt: 1,
      groups: [{ id: "abc", name: "Work" }],
    });
    expect("groups" in idx).toBe(false);
  });

  it("lists a fresh vault with no groups", async () => {
    const { vault } = await setup();
    expect((await vault.listAccounts()).groups).toEqual([]);
  });

  it("treats a dangling groupId (index rebuilt) as ungrouped", async () => {
    const { vault } = await setup();
    const g = await vault.createGroup("Work");
    const a = await vault.addAccount(input("A"));
    await vault.updateAccount(a.id, { groupId: g.id });
    await vault.rebuildIndex();
    const listing = await vault.listAccounts();
    expect(listing.groups).toEqual([]);
    expect(listing.accounts[0]!.groupId).toBeUndefined();
  });
});
