// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AddAccount } from "../src/ui/popup/AddAccount";
import { PopupApp } from "../src/ui/popup/PopupApp";
import { SecurityScreen } from "../src/ui/manage/SecurityScreen";
import { SetupWizard } from "../src/ui/manage/SetupWizard";
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
