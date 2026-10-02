import { describe, expect, it } from "vitest";
import type { VaultService } from "../src/background/vaultService";
import { internals, plant } from "./helpers/duplicates";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const OTHER = "GEZDGNBVGY3TQOJQ";

const add = (service: VaultService, draft: object) => service.addAccount({ draft: draft as never });

describe("listDuplicates", () => {
  it("reports exact groups with a suggested keeper and never a secret", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "me" });
    const b = await plant(service, a.id, { label: "" });
    const c = await plant(service, a.id, { domains: ["github.com"] });
    const result = await service.listDuplicates();
    expect(result.groups).toEqual([
      { kind: "exact", ids: [a.id, b.id, c.id], keepId: c.id, ineligible: [] },
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("flags same-secret and similar groups without a keeper", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "me" });
    await plant(service, a.id, { digits: 8, issuer: "Other" });
    await plant(service, a.id, { secret: OTHER });
    const kinds = (await service.listDuplicates()).groups.map((g) => g.kind);
    expect(kinds).toContain("same-secret");
    expect(kinds).toContain("similar");
    for (const g of (await service.listDuplicates()).groups.filter((g) => g.kind !== "exact"))
      expect(g.keepId).toBeNull();
  });

  it("marks lower-counter hotp accounts as ineligible", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { type: "hotp", secret: SECRET, issuer: "Bank", counter: 2 });
    const b = await plant(service, a.id, { counter: 9 });
    const [group] = (await service.listDuplicates()).groups;
    expect(group).toMatchObject({ kind: "exact", keepId: b.id, ineligible: [a.id] });
  });

  it("is refused while locked", async () => {
    const { service } = await unlockedService();
    await service.lock();
    expect(await codeOf(service.listDuplicates())).toBe("locked");
  });
});

describe("mergeAccounts", () => {
  it("merges fields, pin and group, trashes copies and snapshots first", async () => {
    const { service } = await unlockedService();
    const g = await service.createGroup("Work");
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "" });
    const b = await plant(service, a.id, { label: "me", domains: ["github.com"], groupId: g.id });
    await service.setPinned(b.id, true);
    const result = await service.mergeAccounts(a.id, [b.id]);
    expect(result.removed).toEqual([b.id]);
    expect(result.undoId).toMatch(/\S/);
    const view = await service.listAccounts();
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0]).toMatchObject({
      id: a.id,
      label: "me",
      domains: ["github.com"],
      pinned: true,
      groupId: g.id,
    });
    expect((await service.listTrash()).map((i) => i.id)).toEqual([b.id]);
    const reasons = (await service.listSnapshots()).map((s) => s.reason);
    expect(reasons).toContain("before-merge");
  });

  it("keeps the highest hotp counter and refuses a lower-counter keeper", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { type: "hotp", secret: SECRET, issuer: "Bank", counter: 2 });
    const b = await plant(service, a.id, { counter: 9 });
    expect(await codeOf(service.mergeAccounts(a.id, [b.id]))).toBe("invalid-request");
    expect((await service.listAccounts()).accounts).toHaveLength(2);
    await service.mergeAccounts(b.id, [a.id]);
    expect((await service.listAccounts()).accounts.map((x) => x.id)).toEqual([b.id]);
  });

  it("rejects bad requests without deleting anything", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "me" });
    const exact = await plant(service, a.id);
    const params = await plant(service, a.id, { digits: 8 });
    const diffSecret = await plant(service, a.id, { secret: OTHER });
    const bad: [string, string[]][] = [
      [a.id, []],
      [a.id, [a.id]],
      [a.id, ["nope"]],
      [a.id, [exact.id, params.id]],
      [a.id, [diffSecret.id]],
      ["nope", [exact.id]],
      [a.id, Array.from({ length: 51 }, (_, i) => `x${i}`)],
    ];
    for (const [keep, remove] of bad)
      expect(await codeOf(service.mergeAccounts(keep, remove))).toBe("invalid-request");
    expect((await service.listAccounts()).accounts).toHaveLength(4);
    expect(await service.listTrash()).toEqual([]);
  });

  it("is refused while locked", async () => {
    const { service } = await unlockedService();
    await service.lock();
    expect(await codeOf(service.mergeAccounts("a", ["b"]))).toBe("locked");
  });

  it("keeps the updated keeper and the remaining copies when a delete fails midway", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "" });
    const b = await plant(service, a.id, { label: "me" });
    const c = await plant(service, a.id);
    const v = internals(service);
    const real = v.deleteAccount.bind(v);
    let calls = 0;
    v.deleteAccount = async (id) => {
      if (++calls === 2) throw new Error("boom");
      return real(id);
    };
    await expect(service.mergeAccounts(a.id, [b.id, c.id])).rejects.toThrow("boom");
    const ids = (await service.listAccounts()).accounts.map((x) => x.id);
    expect(ids).toEqual([a.id, c.id]);
    expect((await service.listAccounts()).accounts[0]!.label).toBe("me");
  });
});

describe("undoMerge", () => {
  it("restores every removed copy next to the keeper", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "me" });
    const b = await plant(service, a.id);
    const c = await plant(service, a.id);
    const { undoId } = await service.mergeAccounts(a.id, [b.id, c.id]);
    expect(await service.undoMerge(undoId)).toEqual({ restored: 2 });
    expect((await service.listAccounts()).accounts).toHaveLength(3);
    expect(await service.listTrash()).toEqual([]);
    expect(await codeOf(service.undoMerge(undoId))).toBe("not-found");
  });

  it("expires after 60 seconds and is cleared by lock", async () => {
    const { service, p } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "me" });
    const b = await plant(service, a.id);
    const first = await service.mergeAccounts(a.id, [b.id]);
    p.clock.advance(61_000);
    expect(await codeOf(service.undoMerge(first.undoId))).toBe("not-found");

    const c = await plant(service, a.id);
    const second = await service.mergeAccounts(a.id, [c.id]);
    await service.lock();
    await service.unlock(PASSWORD);
    expect(await codeOf(service.undoMerge(second.undoId))).toBe("not-found");
  });

  it("does not revert keeper edits and plain restoreTrash still refuses a duplicate", async () => {
    const { service } = await unlockedService();
    const a = await add(service, { secret: SECRET, issuer: "GitHub", label: "" });
    const b = await plant(service, a.id, { label: "me" });
    await service.mergeAccounts(a.id, [b.id]);
    expect(await codeOf(service.restoreTrash(b.id))).toBe("duplicate-account");
    expect((await service.listAccounts()).accounts[0]!.label).toBe("me");
  });
});
