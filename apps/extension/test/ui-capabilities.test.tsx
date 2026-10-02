// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AddAccount, PopupApp } from "@otp-vault/ui/popup";
import { SecurityScreen, SetupWizard } from "@otp-vault/ui/manage";
import { harness, renderUi } from "./helpers/ui";

const NONE = {
  activeTab: false,
  qrScan: false,
  autofill: false,
  clockCheck: false,
  storageArea: false,
};

describe("a platform without page, clock or sync abilities", () => {
  it("never asks the platform for the active tab", async () => {
    const h = await harness({ tabUrl: "https://example.com/login", capabilities: NONE });
    renderUi(<PopupApp />, h.ui);
    await screen.findByRole("button", { name: /Hesap ekle|Ekle/ });
    expect(h.ui.activeTab).not.toHaveBeenCalled();
    expect(screen.queryByText("Bu site")).toBeNull();
  });

  it("shows no fill control and no site section for a seeded matching account", async () => {
    const seed = async (capabilities?: Partial<typeof NONE>) => {
      const h = await harness({ tabUrl: "https://acme.com/login", capabilities });
      await h.ui.rpc("addAccountUri", {
        uri: "otpauth://totp/Acme:me?secret=JBSWY3DPEHPK3PXP&issuer=Acme",
        sourceUrl: "https://acme.com",
      });
      return h;
    };
    const control = await seed();
    const view = renderUi(<PopupApp pollMs={0} />, control.ui);
    await screen.findByRole("button", { name: "Acme kodunu sayfaya doldur" });
    expect(screen.getByText("Bu site")).toBeTruthy();
    view.unmount();

    const h = await seed(NONE);
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Acme");
    expect(screen.queryByRole("button", { name: /doldur/i })).toBeNull();
    expect(screen.queryByText("Doldur")).toBeNull();
    expect(screen.queryByText("Bu site")).toBeNull();
    expect(h.ui.activeTab).not.toHaveBeenCalled();
  });

  it("shows the site section but no fill button when autofill is off", async () => {
    const h = await harness({
      tabUrl: "https://acme.com/login",
      capabilities: { activeTab: true, autofill: false },
    });
    await h.ui.rpc("addAccountUri", {
      uri: "otpauth://totp/Acme:me?secret=JBSWY3DPEHPK3PXP&issuer=Acme",
      sourceUrl: "https://acme.com",
    });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Acme");
    expect(screen.getByText("Bu site")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /doldur/i })).toBeNull();
    expect(screen.queryByText("Doldur")).toBeNull();
  });

  it("numbers the add options 01 and 02 without QR scan", async () => {
    const h = await harness({ capabilities: NONE });
    renderUi(<AddAccount onBack={() => {}} onAdded={() => {}} />, h.ui);
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("02")).toBeTruthy();
    expect(screen.queryByText("03")).toBeNull();
  });

  it("hides the page QR scan option", async () => {
    const h = await harness({ capabilities: NONE });
    renderUi(<AddAccount onBack={() => {}} onAdded={() => {}} />, h.ui);
    expect(screen.queryByRole("button", { name: /Ekrandan QR tara/ })).toBeNull();
    expect(screen.getByRole("button", { name: /İçe aktar/ })).toBeTruthy();
    expect(h.ui.captureTab).not.toHaveBeenCalled();
  });

  it("hides clock, fill, memory and shortcut rows on the security page", async () => {
    const h = await harness({ capabilities: NONE });
    renderUi(<SecurityScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    expect(screen.queryByText("Saat kontrolü")).toBeNull();
    expect(screen.queryByText("Yalnızca bağlı sitede doldur")).toBeNull();
    expect(screen.queryByText("Kullandığım siteleri hatırla")).toBeNull();
    expect(screen.queryByText("Klavye kısayolu: Alt+Shift+O")).toBeNull();
    expect(screen.getByText("Doldurma, görünüm ve pano", { exact: false })).toBeTruthy();
  });

  it("skips the storage step in the setup wizard", async () => {
    const h = await harness({ status: "no-vault", capabilities: NONE });
    renderUi(<SetupWizard onFinished={() => {}} />, h.ui);
    await userEvent.type(screen.getByLabelText("Ana parola"), "kirmizi bisiklet ruzgar");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "kirmizi bisiklet ruzgar");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await waitFor(() =>
      expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("İlk hesap"),
    );
    expect(screen.queryByText("Tarayıcı senkronizasyonu")).toBeNull();
  });

  it("keeps every ability on by default (the extension)", async () => {
    const h = await harness({ tabUrl: "https://example.com/login" });
    expect(h.ui.capabilities).toEqual({
      activeTab: true,
      qrScan: true,
      autofill: true,
      clockCheck: true,
      storageArea: true,
    });
    expect(h.ui.reportsScreenLock).toBe(true);
  });
});
