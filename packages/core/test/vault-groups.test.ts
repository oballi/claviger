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
    for (const bad of [
      "a\u0000b",
      "a\u0007b",
      "a\u202Eb",
      "a\u2066b",
      "a\u2069b",
      "a\u202Ab",
      "a\u200Bb",
      "a\u200Eb",
      "a\uFEFFb",
    ])
      expect(await asyncCodeOf(vault.createGroup(bad))).toBe("invalid-group-name");
    await expect(vault.createGroup("a\u200Db")).resolves.toBeTruthy();
    await expect(vault.createGroup("a\u200Cb")).resolves.toBeTruthy();
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
    expect(await asyncCodeOf(vault.createGroup("cafe\u0301"))).toBe("duplicate-group");
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
    expect((await vault.listAccounts()).groups.map((g) => g.id)).toEqual([c.id, a.id, b.id]);
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
    expect(listing.accounts.map((x) => x.id)).toEqual([a.id, b.id, c.id]);
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

describe("read tolerance and tombstones", () => {
  it("reads an index with limits beyond this version's write limits", async () => {
    const { vault, deps } = await setup();
    const g = await vault.createGroup("Work");
    const a = await vault.addAccount(input("A"));
    await vault.updateAccount(a.id, { groupId: g.id });
    const { encryptRecord } = await import("../src/vault/records");
    const { INDEX_KEY } = await import("../src/vault/format");
    const dek = (vault as unknown as { dek: Uint8Array }).dek;
    const groups = Array.from({ length: 31 }, (_, i) => ({
      id: i === 0 ? g.id : `id${i}`,
      name: i === 0 ? "x".repeat(100) : `n${i}`,
    }));
    const index = { order: [a.id], pinned: [], updatedAt: 1e12, groups };
    await deps.storage.set({
      [INDEX_KEY]: await encryptRecord(dek, INDEX_KEY, index, index.updatedAt, deps.random),
    });
    const listing = await vault.listAccounts();
    expect(listing.indexDamaged).toBe(false);
    expect(listing.groups).toHaveLength(31);
    expect(listing.accounts[0]!.groupId).toBe(g.id);
  });

  it("keeps a dangling groupId ungrouped over an update without groupId", async () => {
    const { vault } = await setup();
    const g = await vault.createGroup("Work");
    const a = await vault.addAccount(input("A"));
    await vault.updateAccount(a.id, { groupId: g.id });
    await vault.rebuildIndex();
    await vault.updateAccount(a.id, { label: "x" });
    expect((await vault.listAccounts()).accounts[0]!.groupId).toBeUndefined();
  });

  it("refuses to update or increment an account whose tombstone is newer", async () => {
    const { vault, deps } = await setup();
    const a = await vault.addAccount(input("A"));
    const h = await vault.addAccount(
      normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP", type: "hotp", issuer: "H" }),
    );
    for (const id of [a.id, h.id])
      await deps.storage.set({ [`vault:tomb:${id}`]: { deletedAt: 9e15 } });
    const before = JSON.stringify(await deps.storage.get());
    expect(await asyncCodeOf(vault.updateAccount(a.id, { groupId: null }))).toBe(
      "account-not-found",
    );
    expect(await asyncCodeOf(vault.incrementHotp(h.id))).toBe("account-not-found");
    expect(JSON.stringify(await deps.storage.get())).toBe(before);
  });
});

describe("addAccountsWithGroups", () => {
  it("reuses groups case-insensitively, creates missing ones in the given order", async () => {
    const { vault } = await setup();
    const work = await vault.createGroup("Work");
    const r = await vault.addAccountsWithGroups(
      [
        input("A", "JBSWY3DPEHPK3PXP"),
        input("B", "GEZDGNBVGY3TQOJQ"),
        input("C", "MFRGGZDFMZTWQ2LK"),
      ],
      ["work", "Zeta", undefined],
      ["Zeta", "Alpha", "work"],
    );
    expect(r.ungrouped).toBe(0);
    const listing = await vault.listAccounts();
    expect(listing.groups.map((x) => x.name)).toEqual(["Work", "Zeta"]);
    const byIssuer = Object.fromEntries(listing.accounts.map((a) => [a.issuer, a.groupId]));
    expect(byIssuer).toEqual({ A: work.id, B: listing.groups[1]!.id, C: undefined });
  });

  it("imports an account with an invalid group name ungrouped", async () => {
    const { vault } = await setup();
    const r = await vault.addAccountsWithGroups([input("A")], ["x".repeat(41)], []);
    expect(r.added).toHaveLength(1);
    expect(r.ungrouped).toBe(0);
    expect((await vault.listAccounts()).groups).toEqual([]);
  });

  it("files the rest ungrouped and counts them past the group limit", async () => {
    const { vault } = await setup();
    const names = Array.from({ length: 31 }, (_, i) => `G${i}`);
    const inputs = names.map((_, i) =>
      normalizeAccountInput({
        secret: `JBSWY3DPEHPK3PX${"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[i]}`,
        issuer: `I${i}`,
      }),
    );
    const r = await vault.addAccountsWithGroups(inputs, names, names);
    expect(r.added).toHaveLength(31);
    expect(r.ungrouped).toBe(1);
    const listing = await vault.listAccounts();
    expect(listing.groups).toHaveLength(30);
    expect(listing.accounts.filter((a) => !a.groupId)).toHaveLength(1);
  });
});
