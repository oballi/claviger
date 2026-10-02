// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsScreen, GroupsSection } from "@otp-vault/ui/manage";
import { harness, renderUi } from "./helpers/ui";

expect.extend({
  toHaveFocus(received: Element) {
    const pass = document.activeElement === received;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to have focus` };
  },
});
declare module "vitest" {
  interface Assertion {
    toHaveFocus(): void;
  }
}

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

  it("moving the first group down to the bottom focuses its up button", async () => {
    const h = await open();
    const down = () => within(h.section).getByRole("button", { name: "İş grubunu aşağı taşı" });
    await userEvent.click(down());
    await vi.waitFor(() =>
      expect(
        within(h.section).getByRole("button", { name: "İş grubunu yukarı taşı" }),
      ).toHaveFocus(),
    );
  });

  it("refocuses the same button when it stays enabled", async () => {
    const h = await open();
    await h.ui.rpc("createGroup", { name: "Üçüncü" });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    const sections = await screen.findAllByRole("region", { name: "Gruplar" });
    const section = sections[sections.length - 1]!;
    const btn = await within(section).findByRole("button", { name: "İş grubunu aşağı taşı" });
    await userEvent.click(btn);
    await vi.waitFor(() =>
      expect(within(section).getByRole("button", { name: "İş grubunu aşağı taşı" })).toHaveFocus(),
    );
  });

  it("moving the last group up lands at the top and focuses down", async () => {
    const h = await open();
    await userEvent.click(
      within(h.section).getByRole("button", { name: "Kişisel grubunu yukarı taşı" }),
    );
    await vi.waitFor(() =>
      expect(
        within(h.section).getByRole("button", { name: "Kişisel grubunu aşağı taşı" }),
      ).toHaveFocus(),
    );
  });

  it("ignores a second click while the first move is still in flight", async () => {
    const h = await open();
    await h.ui.rpc("createGroup", { name: "Üçüncü" });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    const sections = await screen.findAllByRole("region", { name: "Gruplar" });
    const section = sections[sections.length - 1]!;
    const aDown = await within(section).findByRole("button", { name: "İş grubunu aşağı taşı" });
    const cUp = within(section).getByRole("button", { name: "Üçüncü grubunu yukarı taşı" });
    fireEvent.click(aDown);
    fireEvent.click(cUp);
    await vi.waitFor(async () => expect(await groupNames(h)).toEqual(["Kişisel", "İş", "Üçüncü"]));
    await new Promise((r) => setTimeout(r, 50));
    expect(await groupNames(h)).toEqual(["Kişisel", "İş", "Üçüncü"]);
  });

  it("returns focus to Yeniden adlandır after save, Escape and Vazgeç", async () => {
    const h = await open();
    const rename = () =>
      within(h.section).getByRole("button", { name: "İş grubunu yeniden adlandır" });
    await userEvent.click(rename());
    await userEvent.type(within(h.section).getByLabelText("Grup adı"), "{Escape}");
    await vi.waitFor(() => expect(rename()).toHaveFocus());
    await userEvent.click(rename());
    await userEvent.click(within(h.section).getByRole("button", { name: "Vazgeç" }));
    await vi.waitFor(() => expect(rename()).toHaveFocus());
    expect(await groupNames(h)).toEqual(["İş", "Kişisel"]);
    await userEvent.click(rename());
    await userEvent.type(within(h.section).getByLabelText("Grup adı"), "2{Enter}");
    await vi.waitFor(() =>
      expect(
        within(h.section).getByRole("button", { name: "İş2 grubunu yeniden adlandır" }),
      ).toHaveFocus(),
    );
  });

  it("returns focus to the delete button after cancelling", async () => {
    const h = await open();
    await userEvent.click(within(h.section).getByRole("button", { name: "İş grubunu sil" }));
    await userEvent.click(within(h.section).getByRole("button", { name: "Vazgeç" }));
    await vi.waitFor(() =>
      expect(within(h.section).getByRole("button", { name: "İş grubunu sil" })).toHaveFocus(),
    );
  });

  it("moves focus to the next group's rename button after deleting a group", async () => {
    const h = await open();
    await userEvent.click(within(h.section).getByRole("button", { name: "İş grubunu sil" }));
    await userEvent.click(within(h.section).getByRole("button", { name: "Sil" }));
    await vi.waitFor(() =>
      expect(
        within(h.section).getByRole("button", { name: "Kişisel grubunu yeniden adlandır" }),
      ).toHaveFocus(),
    );
  });

  it("moves focus to the section heading after deleting the last group", async () => {
    const h = await harness();
    await h.ui.rpc("createGroup", { name: "Tek" });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    const section = await screen.findByRole("region", { name: "Gruplar" });
    await userEvent.click(await within(section).findByRole("button", { name: "Tek grubunu sil" }));
    await userEvent.click(within(section).getByRole("button", { name: "Sil" }));
    await vi.waitFor(() =>
      expect(within(section).getByRole("heading", { name: "Gruplar" })).toHaveFocus(),
    );
  });

  it("names the group in the delete confirmation", async () => {
    const h = await open();
    await userEvent.click(within(h.section).getByRole("button", { name: "Kişisel grubunu sil" }));
    expect(within(h.section).getByText(/\u201CKişisel\u201D silinsin mi/)).toBeTruthy();
    expect(within(h.section).getByText(/\(0 hesap\)/)).toBeTruthy();
  });

  it("falls back to Tümü when the selected filter group is deleted", async () => {
    const h = await open();
    const chips = await screen.findByRole("group", { name: "Grup süzgeci" });
    await userEvent.click(within(chips).getByRole("button", { name: "İş · 1" }));
    await userEvent.click(within(h.section).getByRole("button", { name: "İş grubunu sil" }));
    await userEvent.click(within(h.section).getByRole("button", { name: "Sil" }));
    await vi.waitFor(() =>
      expect(
        within(chips).getByRole("button", { name: /^Tümü/ }).getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });

  it("dropping a group on itself changes nothing", async () => {
    const h = await open();
    const first = within(h.section).getByText("İş").closest("li")!;
    fireEvent.dragStart(within(h.section).getAllByTestId("drag-handle")[0]!);
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    await new Promise((r) => setTimeout(r, 50));
    expect(await groupNames(h)).toEqual(["İş", "Kişisel"]);
  });

  it("keeps grip, name toggle, up, down, rename and delete on one row", async () => {
    const h = await open();
    const row = within(h.section).getByText("İş").closest("li")!;
    const first = row.firstElementChild as HTMLElement;
    expect(first.className).toContain("gap-1");
    for (const el of [
      within(row).getByTestId("drag-handle"),
      within(row).getByRole("button", { name: /^İş\s?\d+$/, expanded: false }),
      within(row).getByRole("button", { name: "İş grubunu yukarı taşı" }),
      within(row).getByRole("button", { name: "İş grubunu aşağı taşı" }),
      within(row).getByRole("button", { name: "İş grubunu yeniden adlandır" }),
      within(row).getByRole("button", { name: "İş grubunu sil" }),
    ])
      expect(el.parentElement).toBe(first);
    const up = within(row).getByRole("button", { name: "İş grubunu yukarı taşı" });
    expect(up.className).toContain("px-1");
    expect(up.className).toContain("min-h-11");
    const rename = within(row).getByRole("button", { name: "İş grubunu yeniden adlandır" });
    expect(rename.className).toContain("text-xs");
    expect(rename.className).toContain("font-normal");
    const toggle = within(row).getByRole("button", { name: /^İş\s?\d+$/ });
    expect(toggle.className).toContain("min-w-0");
    expect(toggle.className).toContain("flex-1");
    expect(within(toggle).getByText("İş").className).toContain("truncate");
    expect(within(toggle).getByText("İş").getAttribute("title")).toBe("İş");
  });

  it("expands a group on name click and lists its accounts with aria-expanded", async () => {
    const h = await open();
    const toggle = within(h.section).getByRole("button", { name: /^İş\s?\d+$/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(h.section).queryByText("Alpha")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeTruthy();
    expect(within(h.section).getByText("Alpha")).toBeTruthy();
    expect(
      within(h.section).getByRole("button", { name: "Alpha hesabını gruptan çıkar" }),
    ).toBeTruthy();
    await userEvent.click(toggle);
    expect(within(h.section).queryByText("Alpha")).toBeNull();
  });

  it("shows the empty hint for a group without accounts", async () => {
    const h = await open();
    await userEvent.click(within(h.section).getByRole("button", { name: /^Kişisel\s?\d+$/ }));
    expect(within(h.section).getByText("Boş. Soldan bir hesabı buraya sürükle.")).toBeTruthy();
  });

  it("Remove from group sets the account to no group, announces it and moves focus to the next member", async () => {
    const h = await open();
    const { id: id2 } = await h.ui.rpc("addAccountManual", {
      draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "Beta" },
    });
    await h.ui.rpc("setAccountGroup", { id: id2, groupId: h.a.id });
    const { groups, accounts } = await h.ui.rpc("listAccounts", {});
    const onChanged = vi.fn();
    cleanup();
    renderUi(<GroupsSection groups={groups} accounts={accounts} onChanged={onChanged} />, h.ui);
    const section = await screen.findByRole("region", { name: "Gruplar" });
    await userEvent.click(within(section).getByRole("button", { name: /^İş\s?\d+$/ }));
    await userEvent.click(
      within(section).getByRole("button", { name: "Alpha hesabını gruptan çıkar" }),
    );
    await vi.waitFor(async () => {
      const list = (await h.ui.rpc("listAccounts", {})).accounts;
      expect(list.find((a) => a.id === h.id)!.groupId).toBeNull();
    });
    expect(onChanged).toHaveBeenCalledWith("Alpha gruptan çıkarıldı");
    await vi.waitFor(() =>
      expect(
        within(section).getByRole("button", { name: "Beta hesabını gruptan çıkar" }),
      ).toHaveFocus(),
    );
  });

  it("a failing remove shows the error and keeps the member", async () => {
    const h = await open();
    const { groups, accounts } = await h.ui.rpc("listAccounts", {});
    const ui = {
      ...h.ui,
      rpc: ((type: string, payload: unknown) =>
        type === "setAccountGroup"
          ? Promise.reject(new Error("boom"))
          : h.ui.rpc(type as "getState", payload as never)) as typeof h.ui.rpc,
    };
    cleanup();
    renderUi(<GroupsSection groups={groups} accounts={accounts} onChanged={() => {}} />, ui);
    const section = await screen.findByRole("region", { name: "Gruplar" });
    await userEvent.click(within(section).getByRole("button", { name: /^İş\s?\d+$/ }));
    await userEvent.click(
      within(section).getByRole("button", { name: "Alpha hesabını gruptan çıkar" }),
    );
    expect(await within(section).findByRole("alert")).toBeTruthy();
    expect(within(section).getByText("Alpha")).toBeTruthy();
  });

  it("collapsing and re-expanding keeps members in sync after a reload", async () => {
    const h = await open();
    const toggle = within(h.section).getByRole("button", { name: /^İş\s?\d+$/ });
    await userEvent.click(toggle);
    expect(within(h.section).getByText("Alpha")).toBeTruthy();
    await userEvent.click(toggle);
    await h.ui.rpc("setAccountGroup", { id: h.id, groupId: h.b.id });
    cleanup();
    const { groups, accounts } = await h.ui.rpc("listAccounts", {});
    renderUi(<GroupsSection groups={groups} accounts={accounts} onChanged={() => {}} />, h.ui);
    const section = await screen.findByRole("region", { name: "Gruplar" });
    await userEvent.click(within(section).getByRole("button", { name: /^İş\s?\d+$/ }));
    expect(within(section).queryByText("Alpha")).toBeNull();
    expect(within(section).getByText("Boş. Soldan bir hesabı buraya sürükle.")).toBeTruthy();
  });
});
