// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PopupApp } from "@otp-vault/ui/popup";
import { harness, renderUi } from "./helpers/ui";

async function seeded(tabUrl?: string) {
  const h = await harness({ tabUrl });
  const work = await h.ui.rpc("createGroup", { name: "Work" });
  const ids: Record<string, string> = {};
  for (const [issuer, secret] of [
    ["Alpha", "JBSWY3DPEHPK3PXA"],
    ["Beta", "JBSWY3DPEHPK3PXB"],
  ] as const) {
    ids[issuer] = (await h.ui.rpc("addAccountManual", { draft: { secret, issuer } })).id;
    await h.ui.rpc("setAccountGroup", { id: ids[issuer], groupId: work.id });
  }
  return { ...h, ids, work };
}
const trigger = (name: string) => screen.findByRole("button", { name: `${name} için işlemler` });
beforeEach(() => localStorage.clear());

describe("row menu", () => {
  it("opens with aria state, focuses the first item and closes on Escape with focus back", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const button = await trigger("Alpha");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Alpha için işlemler" });
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("moves with arrow keys, wrapping, and skips disabled items", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    const items = () => within(screen.getByRole("menu")).getAllByRole("menuitem");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items().find((i) => i.textContent === "Aşağı taşı"));
    await userEvent.keyboard("{End}");
    expect(document.activeElement?.textContent).toBe("Sil…");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(
      items().filter((i) => !(i as HTMLButtonElement).disabled)[0],
    );
  });

  it("does not copy when the menu is used and does not clear the search on Escape", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.type(await screen.findByRole("searchbox", { name: "Hesap ara" }), "Alp");
    await userEvent.click(await trigger("Alpha"));
    await userEvent.click(screen.getByRole("menu"));
    expect(h.ui.copy).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("Alp");
    expect(screen.queryByRole("menuitem", { name: /Yukarı taşı/ })).toBeNull();
  });

  it("pins and unpins", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sabitle" }));
    await screen.findByText("Beta sabitlendi.");
    expect(
      (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Beta")!.pinned,
    ).toBe(true);
  });

  it("moves down within the group", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Aşağı taşı" }));
    await vi.waitFor(async () =>
      expect((await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual([
        "Beta",
        "Alpha",
      ]),
    );
  });

  it("moves to another group through the in-menu list, with a back item", async () => {
    const h = await seeded();
    const home = await h.ui.rpc("createGroup", { name: "Home" });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    await userEvent.click(screen.getByRole("menuitem", { name: /Gruba taşı/ }));
    expect(screen.getByRole("menuitem", { name: "Work" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("menuitem", { name: "Geri" }));
    expect(screen.getByRole("menuitem", { name: /Gruba taşı/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: /Gruba taşı/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Home" }));
    await vi.waitFor(async () =>
      expect(
        (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Alpha")!.groupId,
      ).toBe(home.id),
    );
  });

  it("links the active tab's registrable domain and hides the item once linked", async () => {
    const h = await seeded("https://login.example.com/x");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    const item = screen.getByRole("menuitem", { name: /Bu siteye bağla/ });
    expect(item.textContent).toContain("example.com");
    await userEvent.click(item);
    await vi.waitFor(async () =>
      expect(
        (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Alpha")!.domains,
      ).toEqual(["example.com"]),
    );
  });

  it("offers no link item without a usable page", async () => {
    const h = await seeded("chrome://extensions");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    expect(screen.queryByRole("menuitem", { name: /Bu siteye bağla/ })).toBeNull();
  });

  it("confirms deletion inside the row and only then deletes", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("silinsin mi"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect((await h.ui.rpc("listAccounts", {})).accounts).toHaveLength(2);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    await userEvent.click(screen.getByRole("button", { name: "Sil" }));
    await vi.waitFor(async () =>
      expect((await h.ui.rpc("listAccounts", {})).accounts).toHaveLength(1),
    );
    // An identical daily copy may already exist, so "before-delete" is deduplicated against it.
    expect((await h.ui.rpc("listSnapshots", {})).some((s) => s.accountCount === 2)).toBe(true);
  });

  it("Tab from the open menu lands after the trigger, not on body", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    const button = await trigger("Alpha");
    await userEvent.click(button);
    await userEvent.tab();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(button);
  });

  it("returns focus to the account's trigger after pin and after move to group", async () => {
    const h = await seeded();
    const home = await h.ui.rpc("createGroup", { name: "Home" });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sabitle" }));
    await screen.findByText("Beta sabitlendi.");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Beta için işlemler" }),
      ),
    );
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: /Gruba taşı/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Home" }));
    await vi.waitFor(async () =>
      expect(
        (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Beta")!.groupId,
      ).toBe(home.id),
    );
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Beta için işlemler" }),
      ),
    );
  });

  it("Escape cancels the delete confirmation and focuses the trigger", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sil…" }));
    await screen.findByRole("alert");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alert")).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Beta için işlemler" }),
      ),
    );
    expect((await h.ui.rpc("listAccounts", {})).accounts).toHaveLength(2);
  });

  it("focuses the first group, not Back, in the move-to-group list", async () => {
    const h = await seeded();
    await h.ui.rpc("createGroup", { name: "Home" });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    await userEvent.click(screen.getByRole("menuitem", { name: /Gruba taşı/ }));
    expect(document.activeElement?.textContent).toBe("Home");
  });

  it("closes on outside click, and opening a second menu closes the first", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Alpha"));
    await userEvent.click(await trigger("Beta"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Beta için işlemler" })).toBeTruthy();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the error when an action fails", async () => {
    const h = await seeded();
    const real = h.ui.rpc;
    h.ui.rpc = ((type: string, ...rest: unknown[]) =>
      type === "setPinned"
        ? Promise.reject(new Error("boom"))
        : (real as (...a: unknown[]) => unknown)(type, ...rest)) as typeof real;
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sabitle" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Beta sabitlendi.")).toBeNull();
  });

  it("moves to Ungrouped, unpins, and disables move down on the last row", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await trigger("Beta"));
    expect(screen.getByRole("menuitem", { name: "Aşağı taşı" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("menuitem", { name: "Sabitle" }));
    await screen.findByText("Beta sabitlendi.");
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sabitlemeyi kaldır" }));
    await screen.findByText(/sabitlemesi kaldırıldı/);
    await userEvent.click(await trigger("Beta"));
    await userEvent.click(screen.getByRole("menuitem", { name: /Gruba taşı/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Grupsuz" }));
    await vi.waitFor(async () => {
      const b = (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Beta")!;
      expect(b.groupId).toBeNull();
      expect(b.pinned).toBe(false);
    });
  });
});
