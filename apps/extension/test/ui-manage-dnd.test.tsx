// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsScreen } from "@otp-vault/ui/manage";
import { harness, renderUi } from "./helpers/ui";

const dt = (types: string[] = []) => ({
  dataTransfer: { setData: vi.fn(), types, effectAllowed: "" },
});

async function setup(opts: { grouped?: boolean } = {}) {
  const h = await harness();
  const g1 = await h.ui.rpc("createGroup", { name: "İş" });
  const g2 = await h.ui.rpc("createGroup", { name: "Kişisel" });
  const add = async (issuer: string, secret: string) =>
    (await h.ui.rpc("addAccountManual", { draft: { secret, issuer } })).id;
  const a = await add("Alpha", "JBSWY3DPEHPK3PXA");
  const b = await add("Beta", "JBSWY3DPEHPK3PXB");
  const c = await add("Gamma", "JBSWY3DPEHPK3PXC");
  if (opts.grouped) await h.ui.rpc("setAccountGroup", { id: b, groupId: g1.id });
  renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
  const section = await screen.findByRole("region", { name: "Gruplar" });
  await screen.findByText("Alpha");
  const row = (n: string) => screen.getByText(n, { selector: "span" }).closest("tr")!;
  const handle = (n: string) => within(row(n)).getByTestId("drag-handle");
  const groupLi = (name: string) => within(section).getByText(name).closest("li")!;
  const groupOf = async (id: string) =>
    (await h.ui.rpc("listAccounts", {})).accounts.find((x) => x.id === id)!.groupId ?? null;
  return { ...h, g1, g2, a, b, c, section, row, handle, groupLi, groupOf };
}

describe("manage drag between groups", () => {
  it("dropping a table row on a group joins it, opens it and announces it", async () => {
    const s = await setup();
    fireEvent.dragStart(s.handle("Alpha"), dt());
    const li = s.groupLi("İş");
    expect(fireEvent.dragOver(li, dt())).toBe(false);
    fireEvent.drop(li, dt());
    await waitFor(async () => expect(await s.groupOf(s.a)).toBe(s.g1.id));
    await screen.findByText("Alpha → İş");
    const toggle = within(s.section).getByRole("button", { name: "İş, 1 hesap" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("highlights the group during dragover and clears it on leave and drop", async () => {
    const s = await setup();
    const li = s.groupLi("İş");
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.dragOver(li, dt());
    expect(li.className).toContain("bg-hair");
    fireEvent.dragLeave(li, { relatedTarget: document.body });
    expect(li.className).not.toContain("bg-hair");
    fireEvent.dragOver(li, dt());
    fireEvent.drop(li, dt());
    expect(li.className).not.toContain("bg-hair");
    await screen.findByText("Alpha → İş");
  });

  it("does not leave highlight behind after dragend", async () => {
    const s = await setup();
    const li = s.groupLi("İş");
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.dragOver(li, dt());
    fireEvent.dragEnd(s.handle("Alpha"));
    expect(li.className).not.toContain("bg-hair");
  });

  async function openGroup(s: Awaited<ReturnType<typeof setup>>) {
    await userEvent.click(within(s.section).getByRole("button", { name: "İş, 1 hesap" }));
    return within(s.section).getByText("Beta").closest("li")!;
  }

  it("dropping a group member on the table removes it from the group", async () => {
    const s = await setup({ grouped: true });
    const member = await openGroup(s);
    const init = dt();
    fireEvent.dragStart(member, init);
    expect(init.dataTransfer.setData).toHaveBeenCalledWith(expect.stringContaining("account"), s.b);
    const wrapper = screen.getByRole("table").parentElement!;
    expect(fireEvent.dragOver(s.row("Alpha"), dt())).toBe(false);
    expect(wrapper.className).toContain("bg-hair");
    fireEvent.drop(s.row("Alpha"), dt());
    await waitFor(async () => expect(await s.groupOf(s.b)).toBeNull());
    await screen.findByText("Beta gruptan çıkarıldı");
  });

  it("dropping a group member on the Grupsuz zone removes it from the group", async () => {
    const s = await setup({ grouped: true });
    const member = await openGroup(s);
    fireEvent.dragStart(member, dt());
    const zone = screen.getByTestId("ungrouped-drop");
    expect(fireEvent.dragOver(zone, dt())).toBe(false);
    expect(zone.className).toContain("bg-hair");
    fireEvent.drop(zone, dt());
    await waitFor(async () => expect(await s.groupOf(s.b)).toBeNull());
  });

  it("a table row dropped on the table or the Grupsuz zone is not accepted", async () => {
    const s = await setup({ grouped: true });
    const spy = vi.spyOn(s.ui, "rpc");
    fireEvent.dragStart(s.handle("Beta"), dt());
    expect(fireEvent.dragOver(s.row("Alpha"), dt())).toBe(true);
    expect(fireEvent.dragOver(screen.getByTestId("ungrouped-drop"), dt())).toBe(true);
    fireEvent.drop(s.row("Alpha"), dt());
    fireEvent.drop(screen.getByTestId("ungrouped-drop"), dt());
    // A rejected drop must not write; the list is unchanged and nothing is announced.
    expect(spy.mock.calls.some((c) => c[0] === "setAccountGroup" || c[0] === "reorder")).toBe(
      false,
    );
    expect(await s.groupOf(s.b)).toBe(s.g1.id);
  });

  it("rejects an account already in the group and an ungrouped one on the Grupsuz zone", async () => {
    const s = await setup({ grouped: true });
    fireEvent.dragStart(s.handle("Beta"), dt());
    expect(fireEvent.dragOver(s.groupLi("İş"), dt())).toBe(true);
    expect(fireEvent.dragOver(s.groupLi("Kişisel"), dt())).toBe(false);
    fireEvent.dragEnd(s.handle("Beta"));
    const member = await openGroup(s);
    fireEvent.dragStart(member, dt());
    fireEvent.dragEnd(member);
    fireEvent.dragStart(s.handle("Alpha"), dt());
    expect(fireEvent.dragOver(screen.getByTestId("ungrouped-drop"), dt())).toBe(true);
  });

  it("a table row dropped on a group while searching joins it and does not reorder", async () => {
    const s = await setup();
    const spy = vi.spyOn(s.ui, "rpc");
    await userEvent.type(screen.getByRole("searchbox"), "a");
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.drop(s.row("Gamma"), dt());
    fireEvent.dragEnd(s.handle("Alpha"));
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.drop(s.groupLi("İş"), dt());
    await waitFor(async () => expect(await s.groupOf(s.a)).toBe(s.g1.id));
    expect(spy.mock.calls.some((c) => c[0] === "reorder")).toBe(false);
  });

  it("a member dragged directly onto another group moves there", async () => {
    const s = await setup({ grouped: true });
    const member = await openGroup(s);
    fireEvent.dragStart(member, dt());
    expect(fireEvent.dragOver(s.groupLi("Kişisel"), dt())).toBe(false);
    fireEvent.drop(s.groupLi("Kişisel"), dt());
    await waitFor(async () => expect(await s.groupOf(s.b)).toBe(s.g2.id));
    await screen.findByText("Beta → Kişisel");
  });

  it("a failed refresh after a successful move still reports success", async () => {
    const s = await setup();
    const real = s.ui.rpc;
    let moved = false;
    const spy = vi.spyOn(s.ui, "rpc").mockImplementation(((type: string, ...rest: unknown[]) => {
      if (type === "setAccountGroup") moved = true;
      return moved && type === "listAccounts"
        ? Promise.reject(new Error("boom"))
        : (real as (...a: unknown[]) => unknown)(type, ...rest);
    }) as typeof s.ui.rpc);
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.drop(s.groupLi("İş"), dt());
    await screen.findByText("Alpha → İş");
    expect(screen.queryByRole("alert")?.textContent ?? "").not.toContain("boom");
    spy.mockRestore();
    expect(await s.groupOf(s.a)).toBe(s.g1.id);
  });

  it("still reorders groups by their handle, without touching account groups", async () => {
    const s = await setup();
    const spy = vi.spyOn(s.ui, "rpc");
    const handles = within(s.section).getAllByTestId("drag-handle");
    fireEvent.dragStart(handles[0]!, dt());
    fireEvent.dragOver(s.groupLi("Kişisel"), dt());
    fireEvent.drop(s.groupLi("Kişisel"), dt());
    await waitFor(async () =>
      expect((await s.ui.rpc("listAccounts", {})).groups.map((g) => g.name)).toEqual([
        "Kişisel",
        "İş",
      ]),
    );
    expect(spy.mock.calls.some((c) => c[0] === "setAccountGroup")).toBe(false);
  });

  it("does not accept a group drag over the Grupsuz zone, the table or an account drop", async () => {
    const s = await setup({ grouped: true });
    const member = await openGroup(s);
    fireEvent.dragStart(member, dt());
    const group = dt(["application/x-otp-vault-group"]);
    expect(fireEvent.dragOver(screen.getByTestId("ungrouped-drop"), group)).toBe(true);
    expect(fireEvent.dragOver(s.row("Alpha"), group)).toBe(true);
    expect(fireEvent.dragOver(s.groupLi("Kişisel"), group)).toBe(true);
    // A real group-handle drag never starts an account drag.
    fireEvent.dragEnd(member);
    fireEvent.dragStart(within(s.section).getAllByTestId("drag-handle")[0]!, dt());
    expect(fireEvent.dragOver(screen.getByTestId("ungrouped-drop"), dt())).toBe(true);
    expect(fireEvent.dragOver(s.row("Alpha"), dt())).toBe(true);
  });

  it("keeps row reordering inside the same group working", async () => {
    const s = await setup();
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.dragOver(s.row("Gamma"), dt());
    fireEvent.drop(s.row("Gamma"), dt());
    await waitFor(async () =>
      expect((await s.ui.rpc("listAccounts", {})).accounts.map((x) => x.issuer)).toEqual([
        "Beta",
        "Gamma",
        "Alpha",
      ]),
    );
  });

  it("shows an error and keeps the account when the move fails", async () => {
    const s = await setup();
    const real = s.ui.rpc;
    vi.spyOn(s.ui, "rpc").mockImplementation(((type: string, ...rest: unknown[]) =>
      type === "setAccountGroup"
        ? Promise.reject(new Error("boom"))
        : (real as (...a: unknown[]) => unknown)(type, ...rest)) as typeof s.ui.rpc);
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.drop(s.groupLi("İş"), dt());
    await screen.findByRole("alert");
    expect(await s.groupOf(s.a)).toBeNull();
    expect(
      within(s.section).getByRole("button", { name: "İş, 0 hesap" }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("a double drop sends one write", async () => {
    const s = await setup();
    const spy = vi.spyOn(s.ui, "rpc");
    fireEvent.dragStart(s.handle("Alpha"), dt());
    const li = s.groupLi("İş");
    fireEvent.drop(li, dt());
    fireEvent.dragStart(s.handle("Alpha"), dt());
    fireEvent.drop(li, dt());
    await screen.findByText("Alpha → İş");
    expect(spy.mock.calls.filter((c) => c[0] === "setAccountGroup")).toHaveLength(1);
  });

  it("member list indent matches the delete confirm row", async () => {
    const s = await setup({ grouped: true });
    await openGroup(s);
    expect(document.getElementById(`members-${s.g1.id}`)!.className).toContain("pl-8");
  });
});
