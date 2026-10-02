import { describe, expect, it } from "vitest";
import { codeOf, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const add = (
  service: Awaited<ReturnType<typeof unlockedService>>["service"],
  issuer: string,
  secret = SECRET,
) => service.addAccount({ draft: { secret, issuer } });

describe("groups in the service", () => {
  it("lists groups and each account's group", async () => {
    const { service } = await unlockedService();
    const { id } = await add(service, "GitHub");
    expect(await service.listAccounts()).toMatchObject({
      groups: [],
      accounts: [{ id, groupId: null }],
    });
    const work = await service.createGroup("Work");
    await service.setAccountGroup(id, work.id);
    expect(await service.listAccounts()).toMatchObject({
      groups: [work],
      accounts: [{ id, groupId: work.id }],
    });
  });

  it("accepts groupId in updateAccount", async () => {
    const { service } = await unlockedService();
    const { id } = await add(service, "GitHub");
    const g = await service.createGroup("Work");
    await service.updateAccount(id, { label: "me", groupId: g.id });
    expect((await service.listAccounts()).accounts[0]).toMatchObject({
      label: "me",
      groupId: g.id,
    });
    await service.updateAccount(id, { groupId: null });
    expect((await service.listAccounts()).accounts[0]!.groupId).toBeNull();
  });

  it("renames, reorders and deletes; deleting moves members to ungrouped", async () => {
    const { service } = await unlockedService();
    const a = await add(service, "A", "JBSWY3DPEHPK3PXA");
    const b = await add(service, "B", "JBSWY3DPEHPK3PXB");
    const work = await service.createGroup("Work");
    const home = await service.createGroup("Home");
    await service.setAccountGroup(a.id, work.id);
    await service.setAccountGroup(b.id, home.id);
    await service.renameGroup(home.id, "Family");
    await service.reorderGroups([home.id, work.id]);
    let view = await service.listAccounts();
    expect(view.groups.map((g) => g.name)).toEqual(["Family", "Work"]);
    await service.deleteGroup(work.id);
    view = await service.listAccounts();
    expect(view.groups.map((g) => g.name)).toEqual(["Family"]);
    expect(view.accounts.map((x) => x.groupId)).toEqual([null, home.id]);
  });

  it("reorderGroups de-duplicates, ignores unknown ids and appends missing ones", async () => {
    const { service } = await unlockedService();
    const a = await service.createGroup("A");
    const b = await service.createGroup("B");
    const c = await service.createGroup("C");
    await service.reorderGroups([c.id, "unknown", c.id, b.id]);
    expect((await service.listAccounts()).groups.map((g) => g.id)).toEqual([c.id, b.id, a.id]);
  });

  it("takes no snapshot for group changes", async () => {
    const { service } = await unlockedService();
    const g = await service.createGroup("Work");
    const before = (await service.listSnapshots()).length;
    await service.deleteGroup(g.id);
    expect((await service.listSnapshots()).length).toBe(before);
  });

  it("reports core error codes and needs an unlocked vault", async () => {
    const { service } = await unlockedService();
    await service.createGroup("Work");
    expect(await codeOf(service.createGroup("work"))).toBe("duplicate-group");
    expect(await codeOf(service.createGroup(" "))).toBe("invalid-group-name");
    expect(await codeOf(service.renameGroup("nope", "x"))).toBe("group-not-found");
    const acc = await add(service, "A");
    expect(await codeOf(service.setAccountGroup("nope", "x"))).toBe("account-not-found");
    expect(await codeOf(service.setAccountGroup(acc.id, "unknown-group"))).toBe("group-not-found");
    expect(await codeOf(service.updateAccount(acc.id, { groupId: "unknown-group" }))).toBe(
      "group-not-found",
    );
    await service.lock();
    expect(await codeOf(service.createGroup("Other"))).toBe("locked");
  });
});
