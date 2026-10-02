// apps/extension/test/ui-groups-manage.test.tsx
// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsScreen } from "@claviger/ui/manage";
import { harness, renderUi } from "./helpers/ui";

async function seeded() {
  const h = await harness();
  const work = await h.ui.rpc("createGroup", { name: "İş" });
  const home = await h.ui.rpc("createGroup", { name: "Kişisel" });
  const add = async (issuer: string, secret: string, groupId: string | null) => {
    const { id } = await h.ui.rpc("addAccountManual", { draft: { secret, issuer } });
    if (groupId) await h.ui.rpc("setAccountGroup", { id, groupId });
    return id;
  };
  const ids = {
    a: await add("Alpha", "JBSWY3DPEHPK3PXA", work.id),
    b: await add("Beta", "JBSWY3DPEHPK3PXB", work.id),
    c: await add("Gamma", "JBSWY3DPEHPK3PXC", home.id),
    d: await add("Delta", "JBSWY3DPEHPK3PXD", null),
  };
  return { ...h, work, home, ids };
}
const screenFor = async (h: Awaited<ReturnType<typeof seeded>>) =>
  renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
const names = () =>
  within(screen.getAllByRole("table")[0]!)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.textContent);

describe("manage group filter", () => {
  it("shows chips with counts and filters rows", async () => {
    const h = await seeded();
    await screenFor(h);
    const chips = await screen.findByRole("group", { name: "Grup süzgeci" });
    await screen.findByText("Alpha");
    expect(
      within(chips)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Tümü · 4", "İş · 2", "Kişisel · 1", "Grupsuz · 1", "+ Yeni grup"]);
    await userEvent.click(within(chips).getByRole("button", { name: "İş · 2" }));
    expect(within(chips).getByRole("button", { name: "İş · 2" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(names()).toHaveLength(2);
    await userEvent.click(within(chips).getByRole("button", { name: "Grupsuz · 1" }));
    expect(names()).toEqual([expect.stringContaining("Delta")]);
  });

  it("has a Grup column", async () => {
    const h = await seeded();
    await screenFor(h);
    expect(await screen.findByRole("columnheader", { name: "Grup" })).toBeTruthy();
    const row = (await screen.findByText("Gamma")).closest("tr")!;
    expect(within(row).getByText("Kişisel")).toBeTruthy();
  });

  it("creates a group from the chip row and selects it", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "+ Yeni grup" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Grup adı"), "Aile");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByRole("button", { name: "Aile · 0", pressed: true })).toBeTruthy();
  });

  it("changes an account's group in the edit dialog", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "Delta hesabını düzenle" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Grup"), "Kişisel");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    await vi.waitFor(async () =>
      expect(
        (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Delta")!.groupId,
      ).toBe(h.home.id),
    );
  });

  it("saves without sending the group when it was deleted elsewhere", async () => {
    const h = await seeded();
    await screenFor(h);
    await h.ui.rpc("deleteGroup", { id: h.work.id });
    await userEvent.click(await screen.findByRole("button", { name: "Alpha hesabını düzenle" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Hesap"), "zz");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    await vi.waitFor(async () =>
      expect(
        (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Alpha")!.label,
      ).toContain("zz"),
    );
  });

  it("moves up/down only inside the group", async () => {
    const h = await harness();
    const g1 = await h.ui.rpc("createGroup", { name: "G1" });
    const g2 = await h.ui.rpc("createGroup", { name: "G2" });
    const add = async (issuer: string, secret: string, groupId: string) => {
      const { id } = await h.ui.rpc("addAccountManual", { draft: { secret, issuer } });
      await h.ui.rpc("setAccountGroup", { id, groupId });
    };
    await add("A1", "JBSWY3DPEHPK3PXA", g1.id);
    await add("B1", "JBSWY3DPEHPK3PXB", g2.id);
    await add("A2", "JBSWY3DPEHPK3PXC", g1.id);
    await screenFor(h as never);
    await userEvent.click(await screen.findByRole("button", { name: "A1 hesabını düzenle" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Yukarı taşı" })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Aşağı taşı" }));
    await vi.waitFor(async () =>
      expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual([
        "A2",
        "B1",
        "A1",
      ]),
    );
    // A1 is now the last of its group; the next row belongs to another group.
    expect(within(dialog).getByRole("button", { name: "Aşağı taşı" })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Kapat" }));
    await userEvent.click(await screen.findByRole("button", { name: "B1 hesabını düzenle" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Yukarı taşı" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByRole("button", { name: "Aşağı taşı" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("counts a dangling groupId as ungrouped", async () => {
    const h = await seeded();
    const ui = {
      ...h.ui,
      rpc: (async (type: string, payload: unknown) => {
        const r = await (h.ui.rpc as (t: string, p: unknown) => Promise<unknown>)(type, payload);
        if (type !== "listAccounts") return r;
        const l = r as { groups: { id: string }[] };
        return { ...l, groups: l.groups.filter((g) => g.id !== h.home.id) };
      }) as typeof h.ui.rpc,
    };
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Grupsuz · 2" }));
    expect(names().join("|")).toMatch(/Gamma.*Delta|Delta.*Gamma/);
    expect(names()).toHaveLength(2);
  });

  it("falls back to Tümü when the selected group is deleted", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "Kişisel · 1" }));
    expect(names()).toHaveLength(1);
    await h.ui.rpc("deleteGroup", { id: h.home.id });
    fireEvent.focus(window);
    expect(await screen.findByRole("button", { name: "Tümü · 4", pressed: true })).toBeTruthy();
    expect(names()).toHaveLength(4);
  });

  it("shows a duplicate group error in the dialog", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "+ Yeni grup" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Grup adı"), "iş");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("zaten var");
  });

  it("shows an empty-group message without the snapshot offer", async () => {
    const h = await seeded();
    await h.ui.rpc("createGroup", { name: "Boş" });
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "Boş · 0" }));
    expect(await screen.findByText("Bu grupta hesap yok.")).toBeTruthy();
  });

  it("reorders inside a filtered view without touching hidden accounts", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "İş · 2" }));
    await userEvent.click(await screen.findByRole("button", { name: "Alpha hesabını düzenle" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Aşağı taşı" }));
    await vi.waitFor(async () =>
      expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual([
        "Beta",
        "Alpha",
        "Gamma",
        "Delta",
      ]),
    );
  });

  it("drops inside a group and refuses a cross-group drop", async () => {
    const h = await seeded();
    await screenFor(h);
    const rowOf = (n: string) => screen.getByText(n).closest("tr")!;
    await screen.findByText("Alpha");
    fireEvent.dragStart(within(rowOf("Alpha")).getByTestId("drag-handle"));
    fireEvent.drop(rowOf("Gamma"));
    await new Promise((r) => setTimeout(r, 50));
    expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
    fireEvent.dragStart(within(rowOf("Alpha")).getByTestId("drag-handle"));
    fireEvent.drop(rowOf("Beta"));
    await vi.waitFor(async () =>
      expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual([
        "Beta",
        "Alpha",
        "Gamma",
        "Delta",
      ]),
    );
  });

  it("ignores drag hover across groups but accepts it inside one", async () => {
    const h = await seeded();
    await screenFor(h);
    const rowOf = (n: string) => screen.getByText(n).closest("tr")!;
    await screen.findByText("Alpha");
    fireEvent.dragStart(within(rowOf("Alpha")).getByTestId("drag-handle"));
    expect(fireEvent.dragOver(rowOf("Beta"))).toBe(false);
    expect(fireEvent.dragOver(rowOf("Gamma"))).toBe(true);
  });

  it("combines the filter with search", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "İş · 2" }));
    await userEvent.type(screen.getByRole("searchbox"), "Beta");
    expect(names()).toHaveLength(1);
  });
});
