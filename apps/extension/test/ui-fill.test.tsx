// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PopupApp } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";

async function popupOn(tabUrl: string, opts: { fillOnlyLinked?: boolean } = {}) {
  const h = await harness({ tabUrl });
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/Acme:me?secret=${SECRET}&issuer=Acme`,
    sourceUrl: "https://acme.com",
  });
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/Zed:me?secret=GEZDGNBVGY3TQOJQ&issuer=Zed`,
  });
  if (opts.fillOnlyLinked === false) await h.ui.rpc("setFillOnlyLinked", { value: false });
  return h;
}

function open(h: Awaited<ReturnType<typeof harness>>) {
  renderUi(<PopupApp pollMs={0} />, h.ui);
}

describe("popup fill", () => {
  it("fills from the popup and shows a toast", async () => {
    const h = await popupOn("https://acme.com/login");
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(await screen.findByText("Dolduruldu")).toBeTruthy();
    expect(h.p.tabs.fills).toHaveLength(1);
    expect(h.p.tabs.fills[0]?.expectedDomain).toBe("acme.com");
    expect(h.ui.copy).not.toHaveBeenCalled();
  });

  it("does not copy when a button inside the row is clicked", async () => {
    const h = await popupOn("https://acme.com/login");
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(await screen.findByText("Dolduruldu")).toBeTruthy();
    expect(h.ui.copy).not.toHaveBeenCalled();
  });

  it("fills once on a double click while a fill is in flight", async () => {
    const h = await popupOn("https://acme.com/login");
    open(h);
    const button = await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" });
    await userEvent.dblClick(button);
    expect(await screen.findByText("Dolduruldu")).toBeTruthy();
    expect(h.p.tabs.fills).toHaveLength(1);
  });

  it("copies when the page has no field", async () => {
    const h = await popupOn("https://acme.com/login");
    h.p.tabs.next = "no-field";
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(await screen.findByText("Alan bulunamadı; kod kopyalandı")).toBeTruthy();
    expect(h.ui.copy).toHaveBeenCalledWith(expect.stringMatching(/^\d{6}$/));
  });

  it("copies with the refusal message when the page refuses", async () => {
    const h = await popupOn("https://acme.com/login");
    h.p.tabs.next = null;
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(await screen.findByText("Bu sayfaya yazılamıyor; kod kopyalandı")).toBeTruthy();
    expect(h.ui.copy).toHaveBeenCalled();
  });

  it("asks before filling an unlinked site when allowed", async () => {
    const h = await popupOn("https://acme.org/login", { fillOnlyLinked: false });
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(
      await screen.findByText("Acme, acme.org sitesine bağlı değil. Yine de doldurulsun mu?"),
    ).toBeTruthy();
    expect(h.p.tabs.fills).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByText(/Yine de doldurulsun mu/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Acme kodunu sayfaya doldur" }));
    await userEvent.click(await screen.findByRole("button", { name: "Doldur" }));
    expect(await screen.findByText("Dolduruldu")).toBeTruthy();
    expect(h.p.tabs.fills[0]?.expectedDomain).toBe("acme.org");
  });

  it("offers to link the site after a confirmed fill", async () => {
    const h = await popupOn("https://acme.org/login", { fillOnlyLinked: false });
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Doldur" }));
    await userEvent.click(await screen.findByRole("button", { name: "Bu siteyi hesaba bağla" }));
    expect(await screen.findByText("Site hesaba bağlandı")).toBeTruthy();
    const acme = (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Acme");
    expect(acme?.domains.sort()).toEqual(["acme.com", "acme.org"]);
  });

  it("blocks an unlinked site when fill-only-linked is on", async () => {
    const h = await popupOn("https://acme.org/login");
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(await screen.findByText("Bu hesap bu siteye bağlı değil.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vazgeç" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Güvenlik ayarları" }));
    expect(h.ui.openManage).toHaveBeenCalledWith("security");
    expect(h.p.tabs.fills).toHaveLength(0);
  });

  it("shows remembered accounts under this site", async () => {
    const h = await popupOn("https://other.net/login", { fillOnlyLinked: false });
    const zed = (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Zed")!;
    await h.service.fillCode({ id: zed.id, tabId: 1, confirmedDomain: "other.net" });
    open(h);
    expect(await screen.findByText(/son kullanılan/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zed kodunu sayfaya doldur" })).toBeTruthy();
  });

  it("never puts digits in the fill button label in hidden mode", async () => {
    const h = await popupOn("https://acme.com/login");
    await h.ui.rpc("setViewMode", { mode: "hidden" });
    open(h);
    const button = await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" });
    expect(button.getAttribute("aria-label")).not.toMatch(/\d/);
  });

  it("never fills a remembered row directly", async () => {
    for (const onlyLinked of [false, true]) {
      const h = await popupOn("https://other.net/login", { fillOnlyLinked: false });
      const zed = (await h.ui.rpc("listAccounts", {})).accounts.find((a) => a.issuer === "Zed")!;
      await h.service.fillCode({ id: zed.id, tabId: 1, confirmedDomain: "other.net" });
      const before = h.p.tabs.fills.length;
      if (onlyLinked) await h.ui.rpc("setFillOnlyLinked", { value: true });
      const view = renderUi(<PopupApp pollMs={0} />, h.ui);
      await userEvent.click(
        await screen.findByRole("button", { name: "Zed kodunu sayfaya doldur" }),
      );
      expect(
        await screen.findByText(
          onlyLinked
            ? "Bu hesap bu siteye bağlı değil."
            : "Zed, other.net sitesine bağlı değil. Yine de doldurulsun mu?",
        ),
      ).toBeTruthy();
      expect(h.p.tabs.fills).toHaveLength(before);
      view.unmount();
    }
  });

  it("keeps digits out of the toast in hidden mode", async () => {
    const h = await popupOn("https://acme.com/login");
    await h.ui.rpc("setViewMode", { mode: "hidden" });
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect((await screen.findByText("Dolduruldu")).textContent).not.toMatch(/\d/);
  });

  it("reports a failed copy instead of a copied toast", async () => {
    const h = await popupOn("https://acme.com/login");
    h.p.tabs.next = "no-field";
    h.ui.copy.mockRejectedValueOnce(new Error("denied"));
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/kod kopyalandı/)).toBeNull();
  });

  it("shows no fill button without an active tab", async () => {
    const h = await popupOn("https://acme.com/login");
    h.ui.activeTab.mockResolvedValue(undefined);
    open(h);
    await screen.findByText("Acme");
    expect(screen.queryByRole("button", { name: /sayfaya doldur/ })).toBeNull();
  });

  it("shows the message of other fill errors", async () => {
    const h = await popupOn("https://acme.com/login");
    open(h);
    const button = await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" });
    h.p.tabs.activeTab = { id: 2, url: "https://acme.com/login" };
    await userEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toMatch(/\S/);
    expect(h.p.tabs.fills).toHaveLength(0);
  });

  it("lets the link offer be dismissed", async () => {
    const h = await popupOn("https://acme.org/login", { fillOnlyLinked: false });
    open(h);
    await userEvent.click(
      await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Doldur" }));
    await userEvent.click(await screen.findByRole("button", { name: "Kapat" }));
    expect(screen.queryByRole("button", { name: "Bu siteyi hesaba bağla" })).toBeNull();
  });
});
