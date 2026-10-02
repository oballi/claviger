// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddAccount } from "../src/ui/popup/AddAccount";
import { harness, renderUi } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";

async function open(tabUrl?: string) {
  const h = await harness({ tabUrl });
  const onBack = vi.fn();
  const onAdded = vi.fn();
  renderUi(
    <AddAccount
      tabUrl={tabUrl}
      tabDomain={tabUrl ? (await h.ui.rpc("listAccounts", { pageUrl: tabUrl })).pageDomain : null}
      onBack={onBack}
      onAdded={onAdded}
    />,
    h.ui,
  );
  return { ...h, onBack, onAdded };
}

const accounts = async (h: Awaited<ReturnType<typeof open>>) =>
  (await h.ui.rpc("listAccounts", {})).accounts;

describe("AddAccount", () => {
  it("lists the sources; QR scanning is not available yet", async () => {
    const h = await open();
    expect(screen.getByRole("heading", { name: "Hesap ekle." })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ekrandan QR tara/ })).toHaveProperty(
      "disabled",
      true,
    );
    await userEvent.click(screen.getByRole("button", { name: /İçe aktar/ }));
    expect(h.ui.openManage).toHaveBeenCalledWith("backup");
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(h.onBack).toHaveBeenCalled();
  });

  it("adds from a pasted link and binds the current site when the box stays ticked", async () => {
    const h = await open("https://github.com/settings/security");
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    expect(screen.getByRole("checkbox", { name: "Bu siteye bağla (github.com)" })).toHaveProperty(
      "checked",
      true,
    );
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("GitHub"));
    expect(await accounts(h)).toMatchObject([{ issuer: "GitHub", domains: ["github.com"] }]);
  });

  it("does not bind the site when the box is cleared", async () => {
    const h = await open("https://mail.google.com/");
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Bu siteye bağla (google.com)" }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.type(screen.getByLabelText("Servis"), "Bank");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("Bank"));
    expect(await accounts(h)).toMatchObject([{ issuer: "Bank", domains: [] }]);
  });

  it("offers no binding without a web page and supports advanced options", async () => {
    const h = await open("chrome://extensions");
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      "jbsw y3dp ehpk 3pxp",
    );
    await userEvent.type(screen.getByLabelText("Hesap"), "ali");
    await userEvent.click(screen.getByText("Gelişmiş"));
    await userEvent.selectOptions(screen.getByLabelText("Tür"), "hotp");
    await userEvent.selectOptions(screen.getByLabelText("Algoritma"), "SHA256");
    await userEvent.clear(screen.getByLabelText("Hane"));
    await userEvent.type(screen.getByLabelText("Hane"), "8");
    await userEvent.clear(screen.getByLabelText("Süre (sn)"));
    await userEvent.type(screen.getByLabelText("Süre (sn)"), "60");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("ali"));
    expect(await accounts(h)).toMatchObject([
      { label: "ali", type: "hotp", algorithm: "SHA256", digits: 8 },
    ]);
  });

  it("explains invalid keys and duplicates, and goes back to the menu", async () => {
    const h = await open();
    await h.ui.rpc("addAccountUri", { uri: `otpauth://totp/x?secret=${SECRET}` });
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    const field = screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı");
    await userEvent.type(field, "not base32!");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Kurulum anahtarı geçersiz. Yalnızca A–Z ve 2–7 karakterleri olabilir.",
      ),
    );
    await userEvent.clear(field);
    await userEvent.type(field, SECRET);
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Bu hesap zaten kayıtlı."),
    );
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(screen.getByRole("heading", { name: "Hesap ekle." })).toBeTruthy();
    expect(h.onBack).not.toHaveBeenCalled();
  });

  async function fillSameName(h: Awaited<ReturnType<typeof open>>) {
    await h.ui.rpc("addAccountManual", { draft: { secret: SECRET, issuer: "Bank", label: "me" } });
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      "GEZDGNBVGY3TQOJQ",
    );
    await userEvent.type(screen.getByLabelText("Servis"), "Bank");
    await userEvent.type(screen.getByLabelText("Hesap"), "me");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
  }

  it("asks before saving a second account with the same name", async () => {
    const h = await open();
    await fillSameName(h);
    expect((await screen.findByRole("alert")).textContent).toContain("Bu adla başka bir hesap");
    expect(h.onAdded).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yine de kaydet" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("Bank"));
    expect(await accounts(h)).toHaveLength(2);
  });

  it("resets the same-name warning when a field changes", async () => {
    const h = await open();
    await fillSameName(h);
    await screen.findByRole("button", { name: "Yine de kaydet" });
    await userEvent.type(screen.getByLabelText("Hesap"), "2");
    expect(screen.queryByRole("button", { name: "Yine de kaydet" })).toBeNull();
    expect(screen.getByRole("button", { name: "Hesabı ekle" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("rejects out-of-range digits locally and opens Advanced", async () => {
    const h = await open();
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    const digits = screen.getByLabelText("Hane");
    fireEvent.change(digits, { target: { value: "9" } });
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Hane veya süre değeri geçersiz.");
    expect(document.querySelector("details")!.open).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(digits));
    expect(await accounts(h)).toHaveLength(0);
  });

  it("rejects an out-of-range period locally", async () => {
    const h = await open();
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    const period = screen.getByLabelText("Süre (sn)");
    fireEvent.change(period, { target: { value: "301" } });
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await screen.findByText("Hane veya süre değeri geçersiz.");
    await vi.waitFor(() => expect(document.activeElement).toBe(period));
    expect(await accounts(h)).toHaveLength(0);
  });
});
