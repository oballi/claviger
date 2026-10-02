// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetupWizard, setupReducer, initialSetup } from "../src/ui/manage/SetupWizard";
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
    expect((await ui.rpc("getState", {})).recoveryCodeConfirmed).toBe(false);
    await userEvent.click(done);
    expect(screen.queryByTestId("recovery-code")).toBeNull();
    await vi.waitFor(async () =>
      expect((await ui.rpc("getState", {})).recoveryCodeConfirmed).toBe(true),
    );

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

  it("points to the extension icon and the image import instead of scanning here", async () => {
    const { onFinished } = await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    await userEvent.click(await screen.findByRole("button", { name: "Devam" }));
    await userEvent.click(await screen.findByRole("button", { name: "Devam" }));
    expect(await screen.findByText(/eklenti simgesine tıklayıp tara/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ekrandan QR tara/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "QR görselini içe aktar" }));
    expect(onFinished).toHaveBeenCalledWith("backup");
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

  it("has no Back button once the vault exists", async () => {
    await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    for (let i = 0; i < 2; i++) {
      await screen.findByRole("button", { name: "Devam" });
      expect(screen.queryByRole("button", { name: "Geri" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    }
    await screen.findByRole("heading", { name: "İlk hesabını ekle." });
    expect(screen.queryByRole("button", { name: "Geri" })).toBeNull();
  });

  it("hands over to the lock screen when the vault locks at step 3", async () => {
    const { ui, onFinished } = await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    await screen.findByRole("heading", { name: "Kasan ne zaman kilitlensin?" });
    await userEvent.click(screen.getByRole("radio", { name: "Belirli bir süre kullanılmayınca" }));
    await ui.rpc("lock", {});
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await vi.waitFor(() => expect(onFinished).toHaveBeenCalledWith("accounts"));
  });

  it("calls setup once on a double click", async () => {
    const h = await harness({ status: "no-vault" });
    const rpc = vi.fn(h.ui.rpc);
    renderUi(<SetupWizard onFinished={vi.fn()} />, { ...h.ui, rpc: rpc as typeof h.ui.rpc });
    await enterPassword();
    await userEvent.dblClick(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    expect(rpc.mock.calls.filter((c) => c[0] === "setup")).toHaveLength(1);
  });

  it("moves focus to the heading on step changes", async () => {
    await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    await screen.findByRole("heading", { name: "Kasan ne zaman kilitlensin?" });
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })),
    );
  });

  it("selects a storage option by clicking its hint", async () => {
    await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Şimdilik atla" }));
    await userEvent.click(await screen.findByRole("button", { name: "Devam" }));
    await userEvent.click(await screen.findByText(/Şifreli kasa, tarayıcı hesabınla/));
    expect(screen.getByRole("radio", { name: "Tarayıcı senkronizasyonu" })).toHaveProperty(
      "checked",
      true,
    );
  });

  it("does not show the Enter hint on the recovery code screen", async () => {
    await start();
    await enterPassword();
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    expect(screen.queryByText("Enter ile devam")).toBeNull();
  });
});

describe("setupReducer", () => {
  const typed = { ...initialSetup, password: "secret-pass", confirm: "secret-pass" };

  it("clears the password when storage is applied", () => {
    const s = setupReducer({ ...typed, created: true, step: 3 }, { type: "storageDone" });
    expect(s).toMatchObject({ password: "", step: 4 });
  });

  it("clears the password on a locked handover", () => {
    expect(setupReducer({ ...typed, created: true, step: 2 }, { type: "handover" }).password).toBe(
      "",
    );
  });

  it("keeps the recovery code until the user continues, then drops it", () => {
    const a = setupReducer(typed, { type: "created", recoveryCode: "AAAA-BBBB" });
    expect(a).toMatchObject({ created: true, confirm: "", recoveryCode: "AAAA-BBBB", step: 1 });
    expect(setupReducer(a, { type: "codeDone" })).toMatchObject({ recoveryCode: null, step: 2 });
  });

  it("goes straight to the lock step when no code was created", () => {
    expect(setupReducer(typed, { type: "created", recoveryCode: null }).step).toBe(2);
  });
});
