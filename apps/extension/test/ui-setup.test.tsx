// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetupWizard } from "../src/ui/manage/SetupWizard";
import { harness, renderUi } from "./helpers/ui";

const NEW_PASSWORD = "kirmizi bisiklet ruzgar";

async function start() {
  const h = await harness({ status: "no-vault" });
  const onFinished = vi.fn();
  renderUi(<SetupWizard onFinished={onFinished} />, h.ui);
  return { ...h, onFinished };
}

async function enterPassword(password = NEW_PASSWORD, confirm = password) {
  await userEvent.type(screen.getByLabelText("Ana parola"), password);
  await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Devam" }));
}

const current = () => document.querySelector('[aria-current="step"]')?.textContent;

describe("SetupWizard", () => {
  it("creates a vault with a recovery code, then applies lock policy and sync storage", async () => {
    const { ui, onFinished } = await start();
    expect(current()).toContain("Ana parola");
    await enterPassword();

    expect(current()).toContain("Kurtarma kodu");
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    await userEvent.click(screen.getByRole("button", { name: "Kopyala" }));
    const code = ui.copy.mock.calls[0]![0];
    expect(screen.queryByRole("button", { name: "Geri" })).toBeNull();
    const done = screen.getByRole("button", { name: "Devam" });
    expect(done).toHaveProperty("disabled", true);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(done);
    expect(screen.queryByTestId("recovery-code")).toBeNull();

    expect(current()).toContain("Kilit tercihi");
    await userEvent.click(screen.getByRole("radio", { name: "Belirli bir süre kullanılmayınca" }));
    await userEvent.click(screen.getByRole("radio", { name: "4 saat" }));
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));

    expect(await screen.findByRole("radio", { name: /Yalnızca bu cihaz/ })).toHaveProperty(
      "checked",
      true,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Tarayıcı senkronizasyonu" }));
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    expect(await screen.findByRole("heading", { name: "İlk hesabını ekle." })).toBeTruthy();

    expect(await ui.rpc("getState", {})).toMatchObject({
      status: "unlocked",
      lockPolicy: { kind: "timeout", minutes: 240 },
      storageArea: "sync",
      hasRecoveryCode: true,
    });
    await ui.rpc("lock", {});
    const recovered = await ui.rpc("unlockWithRecovery", {
      code,
      newPassword: "another password",
    });
    expect(recovered.recoveryCode).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla, kurulumu bitir" }));
    expect(onFinished).toHaveBeenCalledWith("accounts");
  });

  it("skips the recovery code with a warning and keeps the defaults", async () => {
    const { ui, onFinished } = await start();
    await enterPassword();
    expect(screen.getByRole("note").textContent).toContain(
      "Parolanı unutursan kodlarına bir daha erişemezsin.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    expect(
      await screen.findByRole("heading", { name: "Kasan ne zaman kilitlensin?" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(await screen.findByRole("button", { name: "Devam" }));
    await userEvent.click(await screen.findByRole("button", { name: /İçe aktar/ }));
    expect(onFinished).toHaveBeenCalledWith("backup");
    expect(await ui.rpc("getState", {})).toMatchObject({
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
      hasRecoveryCode: false,
    });
  });

  it("validates the password and lets the user go back before the vault exists", async () => {
    await start();
    await enterPassword("short");
    expect(screen.getByRole("alert").textContent).toBe("Parola en az 8 karakter olmalı.");
    await userEvent.clear(screen.getByLabelText("Ana parola"));
    await userEvent.clear(screen.getByLabelText("Parolayı tekrar gir"));
    await enterPassword(NEW_PASSWORD, `${NEW_PASSWORD}!`);
    expect(screen.getByRole("alert").textContent).toBe("Parolalar eşleşmiyor.");
    await userEvent.type(screen.getByLabelText("Ana parola"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(screen.getByLabelText("Ana parola")).toHaveProperty("value", `${NEW_PASSWORD}!`);
  });

  it("adds a first account manually and finishes", async () => {
    const { ui, onFinished } = await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    await userEvent.click(await screen.findByRole("button", { name: "Devam" }));
    await userEvent.click(await screen.findByRole("button", { name: "Devam" }));
    await userEvent.click(await screen.findByRole("button", { name: /Elle gir/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      "JBSWY3DPEHPK3PXP",
    );
    await userEvent.type(screen.getByLabelText("Servis"), "GitHub");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    expect(await screen.findByText("GitHub eklendi.")).toBeTruthy();
    expect((await ui.rpc("listAccounts", {})).accounts).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Kurulumu bitir" }));
    expect(onFinished).toHaveBeenCalledWith("accounts");
  });

  it("shows a vault created elsewhere as an error instead of overwriting it", async () => {
    const { ui } = await start();
    await ui.rpc("setup", {
      password: "someone else",
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Bu tarayıcıda zaten bir kasa var. Sayfayı yenile.",
      ),
    );
  });
});
