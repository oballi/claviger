// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LockPolicy } from "../src/background/settings";
import { Dialog } from "../src/ui/components/Dialog";
import { LockPolicyOptions } from "../src/ui/components/LockPolicyOptions";
import { NewPasswordFields, newPasswordProblem } from "../src/ui/components/NewPasswordFields";
import { QrCode } from "../src/ui/components/QrCode";
import { ReauthForm } from "../src/ui/components/ReauthForm";
import { RecoveryCodeDisplay } from "../src/ui/components/RecoveryCodeDisplay";
import { translate } from "../src/ui/i18n/i18n";
import { ManageFrame, PageTitle, SettingsRow, SettingsSection } from "../src/ui/manage/ManageFrame";
import { WizardFrame } from "../src/ui/manage/WizardFrame";
import { harness, renderUi } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate("tr", key, vars);

function DialogHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        aç
      </button>
      {open ? (
        <Dialog
          title="Başlık"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button type="button">birinci</button>
          <button type="button">ikinci</button>
        </Dialog>
      ) : null}
    </>
  );
}

function PolicyHarness({ onChange }: { onChange: (p: LockPolicy) => void }) {
  const [value, setValue] = useState<LockPolicy>({ kind: "browser-close" });
  return (
    <LockPolicyOptions
      value={value}
      onChange={(p) => {
        setValue(p);
        onChange(p);
      }}
    />
  );
}

function PasswordHarness() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <NewPasswordFields
      password={password}
      confirm={confirm}
      onPassword={setPassword}
      onConfirm={setConfirm}
    />
  );
}

describe("Dialog", () => {
  it("traps focus, closes on Escape and returns focus to the opener", async () => {
    const { ui } = await harness();
    const onClose = vi.fn();
    renderUi(<DialogHarness onClose={onClose} />, ui);
    const opener = screen.getByRole("button", { name: "aç" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Başlık" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Kapat" }));
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "ikinci" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Kapat" }));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "ikinci" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });
});

describe("ReauthForm", () => {
  it("shows a wrong password and passes a fresh token and the password on success", async () => {
    const { ui } = await harness();
    const onConfirmed = vi.fn();
    renderUi(<ReauthForm submitLabel="Onayla" onConfirmed={onConfirmed} />, ui);
    const field = screen.getByLabelText("Ana parola");
    expect(document.activeElement).toBe(field);
    await userEvent.type(field, "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Parola yanlış."));
    await userEvent.type(field, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await vi.waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(expect.any(String), PASSWORD));
    expect(field).toHaveProperty("value", "");
  });

  it("shows errors thrown by the confirmed action and can stay unfocused", async () => {
    const { ui } = await harness();
    renderUi(
      <ReauthForm
        submitLabel="Onayla"
        autoFocus={false}
        onConfirmed={async () => {
          throw new Error("boom");
        }}
      />,
      ui,
    );
    const field = screen.getByLabelText("Ana parola");
    expect(document.activeElement).not.toBe(field);
    await userEvent.type(field, PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Beklenmeyen bir hata oluştu."),
    );
  });

  it("can be disabled by its parent", async () => {
    const { ui } = await harness();
    renderUi(<ReauthForm submitLabel="Kapalı" disabled onConfirmed={() => {}} />, ui);
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    expect(screen.getByRole("button", { name: "Kapalı" })).toHaveProperty("disabled", true);
  });

  it("blocks submits while throttled", async () => {
    const { ui } = await harness();
    for (let i = 0; i < 2; i++)
      await ui.rpc("reauth", { password: "wrong password" }).catch(() => undefined);
    renderUi(<ReauthForm submitLabel="Onayla" onConfirmed={() => {}} />, ui);
    await userEvent.type(screen.getByLabelText("Ana parola"), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Parola yanlış."));
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    expect(screen.getByRole("button", { name: "Onayla" })).toHaveProperty("disabled", true);
  });
});

describe("password fields", () => {
  it("requires 8 characters and a matching confirmation", () => {
    expect(newPasswordProblem(t, "short", "short")).toBe("Parola en az 8 karakter olmalı.");
    expect(newPasswordProblem(t, "long enough", "long enougH")).toBe("Parolalar eşleşmiyor.");
    expect(newPasswordProblem(t, "long enough", "long enough")).toBeNull();
  });

  it("shows strength and length as the user types", async () => {
    const { ui } = await harness();
    renderUi(<PasswordHarness />, ui);
    expect(screen.getByText("Çok kısa.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Ana parola"), "abcdefgh");
    expect(screen.getByText("Zayıf.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Ana parola"), "-ruzgar-bisiklet");
    expect(screen.getByText("Çok güçlü.")).toBeTruthy();
    expect(screen.getByText("24 karakter")).toBeTruthy();
  });
});

describe("LockPolicyOptions", () => {
  it("defaults to browser close and offers timeouts and never", async () => {
    const { ui } = await harness();
    const onChange = vi.fn();
    renderUi(<PolicyHarness onChange={onChange} />, ui);
    expect(screen.getByRole("radio", { name: /^Tarayıcı kapanınca\s*önerilen/ })).toHaveProperty(
      "checked",
      true,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Belirli bir süre kullanılmayınca" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "timeout", minutes: 15 });
    await userEvent.click(screen.getByRole("radio", { name: "1 saat" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "timeout", minutes: 60 });
    await userEvent.click(screen.getByRole("radio", { name: "Hiçbir zaman" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "never" });
    expect(screen.getByText("Bu bilgisayara erişen biri kodlarını görebilir.")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Kilit tercihi" })).toBeTruthy();
  });

  it("explains the Firefox screen-lock behaviour", async () => {
    const { ui } = await harness();
    renderUi(<PolicyHarness onChange={() => {}} />, { ...ui, isFirefox: true });
    expect(
      screen.getByText(
        "Firefox ekran kilidini bildirmediği için bu seçenek 5 dk boşta kalınca kilitler.",
      ),
    ).toBeTruthy();
  });
});

describe("RecoveryCodeDisplay", () => {
  it("offers copy, download and print, and continues only after confirmation", async () => {
    const { ui } = await harness();
    const onDone = vi.fn();
    const code = "7KQ2-M9XD-4TFA-PL8W-2HNC-V6RB-Q3JE-8YMS";
    renderUi(<RecoveryCodeDisplay code={code} doneLabel="Devam" onDone={onDone} />, ui);
    expect(screen.getByRole("group", { name: "Kurtarma kodu" }).textContent).toContain("PL8W");
    await userEvent.click(screen.getByRole("button", { name: "Kopyala" }));
    expect(ui.copy).toHaveBeenCalledWith(code);
    await userEvent.click(screen.getByRole("button", { name: "Metin dosyası olarak indir" }));
    expect(ui.download).toHaveBeenCalledWith(
      "otp-vault-kurtarma-kodu.txt",
      expect.stringContaining(code),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yazdır" }));
    expect(ui.print).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Devam" })).toHaveProperty("disabled", true);
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe("frames", () => {
  it("renders the manage navigation with the current section and a lock button", async () => {
    const { ui } = await harness();
    const onLock = vi.fn();
    renderUi(
      <ManageFrame active="security" onLock={onLock}>
        <PageTitle title="Güvenlik." count={3}>
          Açıklama
        </PageTitle>
        <SettingsSection num="01" title="Erişim">
          <SettingsRow title="Satır" description="Ayrıntı" action={<span>eylem</span>}>
            <p>panel</p>
          </SettingsRow>
        </SettingsSection>
      </ManageFrame>,
      ui,
    );
    expect(screen.getByRole("link", { name: "Güvenlik" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Hesaplar" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("region", { name: "Erişim" }).textContent).toContain("panel");
    await userEvent.click(screen.getByRole("button", { name: "Kilitle" }));
    expect(onLock).toHaveBeenCalled();
  });

  it("hides the navigation while signed out", async () => {
    const { ui } = await harness();
    renderUi(<ManageFrame active={null}>içerik</ManageFrame>, ui);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("marks the current and finished setup steps", async () => {
    const { ui } = await harness();
    renderUi(
      <WizardFrame step={2} footer={<span>alt</span>}>
        <p>adım</p>
      </WizardFrame>,
      ui,
    );
    const steps = within(screen.getByRole("navigation", { name: "Kurulum adımları" })).getAllByRole(
      "listitem",
    );
    expect(steps[2]!.getAttribute("aria-current")).toBe("step");
    expect(steps[1]!.getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("03 / 05")).toBeTruthy();
  });

  it("renders a QR code as an image", async () => {
    const { ui } = await harness();
    renderUi(<QrCode value="otpauth://totp/x?secret=JBSWY3DPEHPK3PXP" label="QR" />, ui);
    expect(screen.getByRole("img", { name: "QR" })).toBeTruthy();
  });
});
