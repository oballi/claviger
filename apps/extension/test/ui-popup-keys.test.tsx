// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";

async function seeded(tabUrl?: string) {
  const h = await harness({ tabUrl });
  await h.service.addAccount(
    { uri: `otpauth://totp/Acme:me?secret=${SECRET}&issuer=Acme` },
    { sourceUrl: "https://acme.com" },
  );
  await h.service.addAccount({
    uri: "otpauth://totp/Zed:zed?secret=GEZDGNBVGY3TQOJQ&issuer=Zed",
  });
  return h;
}
const search = () => screen.getByRole("searchbox", { name: "Hesap ara" });
const rowOf = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name} kodunu`) }).closest("li")!;
beforeEach(() => localStorage.clear());

describe("popup keyboard", () => {
  it("focuses search on open and not again after a poll reload", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={20} />, h.ui);
    await screen.findByText("Zed");
    expect(document.activeElement).toBe(search());
    (document.activeElement as HTMLElement).blur();
    await new Promise((r) => setTimeout(r, 120));
    expect(document.activeElement).toBe(document.body);
  });

  it("selects the first row, announces it and moves the selection with the arrows", async () => {
    const h = await seeded("https://acme.com/x");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await waitFor(() => expect(rowOf("Acme").hasAttribute("data-selected")).toBe(true));
    expect(search().getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("button", { name: /^Acme kodunu/ }).id,
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Acme kodunu/ }));
    await userEvent.keyboard("{ArrowDown}");
    expect(rowOf("Zed").hasAttribute("data-selected")).toBe(true);
    expect(rowOf("Acme").hasAttribute("data-selected")).toBe(false);
  });

  it("Enter in search copies the selected row once, with the Copied state", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("{Enter}");
    expect(h.ui.copy).toHaveBeenCalledTimes(1);
    expect(await within(rowOf("Acme")).findByText("Kopyalandı")).toBeTruthy();
  });

  it("Enter on a focused code button copies once (its own click)", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    screen.getByRole("button", { name: /^Zed kodunu/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(h.ui.copy).toHaveBeenCalledTimes(1);
  });

  it("Enter copies the filtered first row", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("zed{Enter}");
    expect(h.ui.copy).toHaveBeenCalledTimes(1);
    expect(within(rowOf("Zed")).getByText("Kopyalandı")).toBeTruthy();
  });

  it("a letter typed on the list goes to search", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    screen.getByRole("button", { name: /^Zed kodunu/ }).focus();
    await userEvent.keyboard("a");
    expect(document.activeElement).toBe(search());
    expect((search() as HTMLInputElement).value).toBe("a");
  });

  it("Escape clears the search, a second fresh Escape closes, a held one does not", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("ze{Escape}");
    expect((search() as HTMLInputElement).value).toBe("");
    expect(h.ui.closePopup).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape>}{/Escape}");
    expect(h.ui.closePopup).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape>3/}");
    expect(h.ui.closePopup).toHaveBeenCalledTimes(2);
  });

  it("Shift+Enter fills a linked account on https and closes the popup", async () => {
    const h = await seeded("https://acme.com/login");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => expect(h.ui.closePopup).toHaveBeenCalled());
    expect(h.p.tabs.fills).toHaveLength(1);
    expect(h.p.tabs.fills[0]).toMatchObject({ tabId: 1, explicit: true });
    expect(h.ui.copy).not.toHaveBeenCalled();
  });

  it("Shift+Enter on a site the account is not linked to only shows a hint", async () => {
    const h = await seeded("https://other.com/");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(await screen.findByText("Bu hesap bu siteye bağlı değil.")).toBeTruthy();
    expect(h.p.tabs.fills).toHaveLength(0);
    expect(h.ui.closePopup).not.toHaveBeenCalled();
  });

  it("Shift+Enter on a plain http page shows the refusal hint", async () => {
    const h = await seeded("http://acme.com/");
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(await screen.findByText("Bu sayfaya doldurulamadı.")).toBeTruthy();
    expect(h.p.tabs.fills).toHaveLength(0);
  });

  it("Shift+Enter without a page copies nothing and hints", async () => {
    const h = await seeded();
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Zed");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(await screen.findByText("Bu sayfaya doldurulamadı.")).toBeTruthy();
    expect(vi.mocked(h.ui.copy)).not.toHaveBeenCalled();
  });
});
