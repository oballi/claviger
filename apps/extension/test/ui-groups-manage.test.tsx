// apps/extension/test/ui-groups-manage.test.tsx
// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsScreen } from "@otp-vault/ui/manage";
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

  it("moves up/down only inside the group", async () => {
    const h = await seeded();
    await screenFor(h);
    await userEvent.click(await screen.findByRole("button", { name: "Alpha hesabını düzenle" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Yukarı taşı" })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Aşağı taşı" }));
    await vi.waitFor(async () =>
      expect(
        (await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer).slice(0, 2),
      ).toEqual(["Beta", "Alpha"]),
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
