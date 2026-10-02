// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsScreen } from "@otp-vault/ui/manage";
import { harness, renderUi } from "./helpers/ui";

async function open() {
  const h = await harness();
  const a = await h.ui.rpc("createGroup", { name: "İş" });
  const b = await h.ui.rpc("createGroup", { name: "Kişisel" });
  const { id } = await h.ui.rpc("addAccountManual", {
    draft: { secret: "JBSWY3DPEHPK3PXA", issuer: "Alpha" },
  });
  await h.ui.rpc("setAccountGroup", { id, groupId: a.id });
  renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
  const section = await screen.findByRole("region", { name: "Gruplar" });
  await within(section).findByText("İş");
  return { ...h, a, b, id, section };
}
const groupNames = async (h: Awaited<ReturnType<typeof open>>) =>
  (await h.ui.rpc("listAccounts", {})).groups.map((g) => g.name);

describe("groups section", () => {
  it("lists groups with counts and the hint", async () => {
    const h = await open();
    const items = within(h.section).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("İş");
    expect(within(items[0]!).getByText("1")).toBeTruthy();
    expect(within(items[1]!).getByText("0")).toBeTruthy();
    expect(within(h.section).getByText(/Gruplar sürüklenerek sıralanır/)).toBeTruthy();
  });

  it("renames inline and reports errors", async () => {
    const h = await open();
    await userEvent.click(
      within(h.section).getByRole("button", { name: "İş grubunu yeniden adlandır" }),
    );
    const field = within(h.section).getByLabelText("Grup adı");
    await userEvent.clear(field);
    await userEvent.type(field, "kişisel{Enter}");
    expect(await within(h.section).findByText("Bu adla bir grup zaten var.")).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, "Work{Enter}");
    await vi.waitFor(async () => expect(await groupNames(h)).toEqual(["Work", "Kişisel"]));
    expect(within(h.section).queryByLabelText("Grup adı")).toBeNull();
  });

  it("Escape and Vazgeç cancel renaming", async () => {
    const h = await open();
    await userEvent.click(
      within(h.section).getByRole("button", { name: "İş grubunu yeniden adlandır" }),
    );
    await userEvent.type(within(h.section).getByLabelText("Grup adı"), "x{Escape}");
    expect(within(h.section).queryByLabelText("Grup adı")).toBeNull();
    expect(await groupNames(h)).toEqual(["İş", "Kişisel"]);
  });

  it("deleting a group keeps its accounts and makes them ungrouped", async () => {
    const h = await open();
    const before = (await h.ui.rpc("listSnapshots", {})).length;
    await userEvent.click(within(h.section).getByRole("button", { name: "İş grubunu sil" }));
    expect(within(h.section).getByText(/Hesaplar silinmez/)).toBeTruthy();
    expect(within(h.section).getByText(/1 hesap/)).toBeTruthy();
    await userEvent.click(within(h.section).getByRole("button", { name: "Sil" }));
    await vi.waitFor(async () => expect(await groupNames(h)).toEqual(["Kişisel"]));
    const accounts = (await h.ui.rpc("listAccounts", {})).accounts;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.groupId).toBeNull();
    expect(await h.ui.rpc("listSnapshots", {})).toHaveLength(before);
  });

  it("cancelling the delete changes nothing", async () => {
    const h = await open();
    await userEvent.click(within(h.section).getByRole("button", { name: "İş grubunu sil" }));
    await userEvent.click(within(h.section).getByRole("button", { name: "Vazgeç" }));
    expect(await groupNames(h)).toEqual(["İş", "Kişisel"]);
  });

  it("reorders with the keyboard buttons", async () => {
    const h = await open();
    expect(
      within(h.section).getByRole("button", { name: "İş grubunu yukarı taşı" }),
    ).toHaveProperty("disabled", true);
    await userEvent.click(within(h.section).getByRole("button", { name: "İş grubunu aşağı taşı" }));
    await vi.waitFor(async () => expect(await groupNames(h)).toEqual(["Kişisel", "İş"]));
    await vi.waitFor(() =>
      expect(
        within(h.section).getByRole("button", { name: "İş grubunu aşağı taşı" }),
      ).toHaveProperty("disabled", true),
    );
  });

  it("reorders by drag and drop", async () => {
    const h = await open();
    const handles = within(h.section).getAllByTestId("drag-handle");
    const second = within(h.section).getByText("Kişisel").closest("li")!;
    fireEvent.dragStart(handles[0]!);
    fireEvent.dragOver(second);
    fireEvent.drop(second);
    await vi.waitFor(async () => expect(await groupNames(h)).toEqual(["Kişisel", "İş"]));
  });
});
