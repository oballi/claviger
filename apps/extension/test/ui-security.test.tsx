// @vitest-environment jsdom
import { Vault } from "@claviger/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ServiceState } from "../src/background/vaultService";
import { describe, expect, it, vi } from "vitest";
import { SecurityScreen } from "@claviger/ui/manage";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

async function open(h?: Harness) {
  const hh = h ?? (await harness());
  const onChanged = vi.fn();
  renderUi(<SecurityScreen state={await hh.ui.rpc("getState", {})} onChanged={onChanged} />, hh.ui);
  return { ...hh, onChanged };
}

const WARNING = /Kurtarma kodunu kaydettiğini onaylamadın/;
const warningNotice = () => screen.getByText(WARNING).closest<HTMLElement>('[role="note"]')!;

const region = (name: string) => screen.getByRole("region", { name });

async function confirmPassword(scope: HTMLElement, button: string, password = PASSWORD) {
  await userEvent.type(within(scope).getByLabelText("Ana parola"), password);
  await userEvent.click(within(scope).getByRole("button", { name: button }));
}

describe("SecurityScreen", () => {
  it("changes the master password after confirming the current one", async () => {
    const { ui, onChanged } = await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await userEvent.type(within(access).getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(
      within(access).getByLabelText("Parolayı tekrar gir"),
      "yeni parola cümlesi",
    );
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await confirmPassword(access, "Parolayı değiştir");
    expect(await screen.findByText("Parola değiştirildi.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
    await ui.rpc("lock", {});
    await expect(ui.rpc("unlock", { password: "yeni parola cümlesi" })).resolves.toBeNull();
  });

  it("validates the new password first", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await userEvent.type(within(access).getByLabelText("Yeni ana parola"), "short");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    expect(within(access).getByText("Parola en az 8 karakter olmalı.")).toBeTruthy();
    await userEvent.click(within(access).getByRole("button", { name: "Vazgeç" }));
    expect(within(access).queryByLabelText("Yeni ana parola")).toBeNull();
  });

  it("disables the password change button while the confirmation does not match", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await userEvent.type(within(access).getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(
      within(access).getByLabelText("Parolayı tekrar gir"),
      "yeni parola cümlesi!",
    );
    expect(within(access).getByText("Parolalar eşleşmiyor.")).toBeTruthy();
    expect(within(access).getByRole("button", { name: "Parolayı değiştir" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("creates a replacement recovery code that invalidates the old one", async () => {
    const { ui, recoveryCode } = await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Yeni kod oluştur" }));
    expect(within(access).getByText("Yeni kod oluşturunca eskisi geçersiz olur.")).toBeTruthy();
    await confirmPassword(access, "Oluştur");
    await within(access).findByTestId("recovery-code");
    await userEvent.click(within(access).getByRole("button", { name: "Kopyala" }));
    const fresh = ui.copy.mock.calls[0]![0];
    await userEvent.click(
      within(access).getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(within(access).getByRole("button", { name: "Tamam" }));
    expect(await screen.findByText("Yeni kurtarma kodu kaydedildi.")).toBeTruthy();
    expect((await ui.rpc("getState", {})).recoveryCodeConfirmed).toBe(true);
    await ui.rpc("lock", {});
    await expect(
      ui.rpc("unlockWithRecovery", { code: recoveryCode!, newPassword: "x".repeat(8) }),
    ).rejects.toMatchObject({ code: "invalid-recovery-code" });
    await expect(
      ui.rpc("unlockWithRecovery", { code: fresh, newPassword: PASSWORD }),
    ).resolves.toBeTruthy();
  });

  it("offers to create a code when there is none", async () => {
    await open(await harness({ recoveryCode: false }));
    expect(screen.getByText(/Kurtarma kodun yok/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kod oluştur" })).toBeTruthy();
  });

  it("changes the lock policy with the password and warns about never", async () => {
    const { ui } = await open();
    const access = region("Erişim");
    await userEvent.selectOptions(
      within(access).getByRole("combobox", { name: "Kilit tercihi" }),
      "never",
    );
    expect(within(access).getByText(/Bu bilgisayara erişen biri kodlarını görebilir/)).toBeTruthy();
    expect(document.activeElement).not.toBe(within(access).getByLabelText("Ana parola"));
    await confirmPassword(access, "Kaydet", "wrong password");
    await vi.waitFor(() =>
      expect(
        within(access)
          .getAllByRole("alert")
          .some((a) => a.textContent === "Parola yanlış."),
      ).toBe(true),
    );
    expect((await ui.rpc("getState", {})).lockPolicy).toEqual({ kind: "browser-close" });
    await confirmPassword(access, "Kaydet");
    expect(await screen.findByText("Kaydedildi.")).toBeTruthy();
    expect((await ui.rpc("getState", {})).lockPolicy).toEqual({ kind: "never" });
  });

  it("explains the Firefox screen-lock fallback", async () => {
    const h = await harness();
    renderUi(<SecurityScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, {
      ...h.ui,
      reportsScreenLock: false,
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Kilit tercihi" }),
      "browser-close-or-screen-lock",
    );
    expect(screen.getByText(/Firefox ekran kilidini bildirmediği/)).toBeTruthy();
  });

  it("turns the reveal password off only after confirmation, with a warning", async () => {
    const { ui } = await open();
    const secrets = region("Pano ve gizli anahtarlar");
    const toggle = within(secrets).getByRole("switch", {
      name: "Gizli anahtarı göstermeden önce parola iste",
    });
    expect(toggle).toHaveProperty("checked", true);
    await userEvent.click(toggle);
    expect(within(secrets).getByText(/tüm gizli anahtarları kopyalayabilir/)).toBeTruthy();
    expect((await ui.rpc("getState", {})).revealRequiresPassword).toBe(true);
    await confirmPassword(secrets, "Kaydet");
    await screen.findByText("Kaydedildi.");
    expect((await ui.rpc("getState", {})).revealRequiresPassword).toBe(false);
  });

  it("asks for the password again for each sensitive change", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.selectOptions(
      within(access).getByRole("combobox", { name: "Kilit tercihi" }),
      "timeout-60",
    );
    await confirmPassword(access, "Kaydet");
    await screen.findByText("Kaydedildi.");
    await userEvent.click(within(region("Pano ve gizli anahtarlar")).getByRole("switch"));
    expect(within(region("Pano ve gizli anahtarlar")).getByLabelText("Ana parola")).toHaveProperty(
      "value",
      "",
    );
  });

  it("deletes the vault only after typing the confirmation word and the password", async () => {
    const { ui, onChanged } = await open();
    const danger = region("Tehlikeli bölge");
    await userEvent.click(within(danger).getByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(within(danger).getByLabelText("Ana parola"), PASSWORD);
    const submit = within(danger).getByRole("button", { name: "Kasayı kalıcı olarak sil" });
    expect(submit).toHaveProperty("disabled", true);
    await userEvent.type(within(danger).getByLabelText("Onaylamak için SİL yaz"), "SİL");
    expect(submit).toHaveProperty("disabled", false);
    await userEvent.click(submit);
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((await ui.rpc("getState", {})).status).toBe("no-vault");
  });

  it("keeps the delete button disabled for a near-miss confirmation word", async () => {
    const { ui, onChanged } = await open();
    const danger = region("Tehlikeli bölge");
    await userEvent.click(within(danger).getByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(within(danger).getByLabelText("Ana parola"), PASSWORD);
    await userEvent.type(within(danger).getByLabelText("Onaylamak için SİL yaz"), "SIL");
    const submit = within(danger).getByRole("button", { name: "Kasayı kalıcı olarak sil" });
    expect(submit).toHaveProperty("disabled", true);
    await userEvent.click(submit);
    expect(onChanged).not.toHaveBeenCalled();
    expect((await ui.rpc("getState", {})).status).toBe("unlocked");
  });

  it("does not delete the vault when the password is wrong", async () => {
    const { ui, onChanged } = await open();
    const danger = region("Tehlikeli bölge");
    await userEvent.click(within(danger).getByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(within(danger).getByLabelText("Onaylamak için SİL yaz"), "SİL");
    await confirmPassword(danger, "Kasayı kalıcı olarak sil", "wrong password");
    await within(danger).findByText("Parola yanlış.");
    expect(onChanged).not.toHaveBeenCalled();
    expect((await ui.rpc("getState", {})).status).toBe("unlocked");
  });

  it("changes nothing when the password is wrong for password, recovery and reveal changes", async () => {
    const { ui, p, onChanged, recoveryCode } = await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await userEvent.type(within(access).getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(
      within(access).getByLabelText("Parolayı tekrar gir"),
      "yeni parola cümlesi",
    );
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await confirmPassword(access, "Parolayı değiştir", "wrong password");
    await within(access).findByText("Parola yanlış.");
    await userEvent.click(within(access).getByRole("button", { name: "Vazgeç" }));

    await userEvent.click(within(access).getByRole("button", { name: "Yeni kod oluştur" }));
    await confirmPassword(access, "Oluştur", "wrong password");
    await within(access).findByText("Parola yanlış.");
    expect(within(access).queryByTestId("recovery-code")).toBeNull();
    await userEvent.click(within(access).getByRole("button", { name: "Vazgeç" }));

    const secrets = region("Pano ve gizli anahtarlar");
    await userEvent.click(within(secrets).getByRole("switch"));
    await confirmPassword(secrets, "Kaydet", "wrong password");
    await within(secrets).findByText("Parola yanlış.");

    expect(onChanged).not.toHaveBeenCalled();
    expect((await ui.rpc("getState", {})).revealRequiresPassword).toBe(true);
    p.clock.advance(60_000);
    await ui.rpc("lock", {});
    await expect(ui.rpc("unlock", { password: PASSWORD })).resolves.toBeNull();
    await ui.rpc("lock", {});
    await expect(
      ui.rpc("unlockWithRecovery", { code: recoveryCode!, newPassword: "x".repeat(8) }),
    ).resolves.toBeTruthy();
  });

  it("fetches a fresh reauth token for every change", async () => {
    const h = await harness();
    const tokens: string[] = [];
    const rpc = h.ui.rpc;
    const ui = {
      ...h.ui,
      rpc: (async (type: string, payload: object) => {
        const result = await (rpc as (t: string, p: object) => Promise<unknown>)(type, payload);
        if (type === "reauth") tokens.push((result as { token: string }).token);
        return result;
      }) as typeof rpc,
    };
    renderUi(<SecurityScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, ui);
    const access = region("Erişim");
    await userEvent.selectOptions(
      within(access).getByRole("combobox", { name: "Kilit tercihi" }),
      "timeout-15",
    );
    await confirmPassword(access, "Kaydet");
    await screen.findByText("Kaydedildi.");
    const secrets = region("Pano ve gizli anahtarlar");
    await userEvent.click(within(secrets).getByRole("switch"));
    await confirmPassword(secrets, "Kaydet");
    await vi.waitFor(() => expect(tokens).toHaveLength(2));
    expect(new Set(tokens).size).toBe(2);
    await vi.waitFor(async () =>
      expect((await h.ui.rpc("getState", {})).revealRequiresPassword).toBe(false),
    );
  });

  it("shows the new recovery code once and only releases it behind the saved checkbox", async () => {
    const { ui } = await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Yeni kod oluştur" }));
    await confirmPassword(access, "Oluştur");
    await within(access).findByTestId("recovery-code");
    const done = within(access).getByRole("button", { name: "Tamam" });
    expect(done).toHaveProperty("disabled", true);
    await userEvent.click(
      within(access).getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(done);
    await screen.findByText("Yeni kurtarma kodu kaydedildi.");
    expect(within(access).queryByTestId("recovery-code")).toBeNull();
    expect(ui.copy).not.toHaveBeenCalled();
    await userEvent.click(within(access).getByRole("button", { name: "Yeni kod oluştur" }));
    expect(within(access).queryByTestId("recovery-code")).toBeNull();
    expect(within(access).getByLabelText("Ana parola")).toBeTruthy();
  });

  it("says the vault is deleted from all synced devices only for the sync area", async () => {
    const sync = await harness({ storageArea: "sync" });
    const { unmount } = renderUi(
      <SecurityScreen state={await sync.ui.rpc("getState", {})} onChanged={() => {}} />,
      sync.ui,
    );
    await userEvent.click(
      within(region("Tehlikeli bölge")).getByRole("button", { name: "Kasayı sil" }),
    );
    expect(
      within(region("Tehlikeli bölge")).getByText("Kasa, eşitlenen tüm cihazlarından silinir."),
    ).toBeTruthy();
    unmount();

    const local = await harness();
    renderUi(
      <SecurityScreen state={await local.ui.rpc("getState", {})} onChanged={() => {}} />,
      local.ui,
    );
    await userEvent.click(
      within(region("Tehlikeli bölge")).getByRole("button", { name: "Kasayı sil" }),
    );
    expect(within(region("Tehlikeli bölge")).queryByText(/eşitlenen/)).toBeNull();
  });

  it("says it in English too", async () => {
    const h = await harness({ storageArea: "sync" });
    renderUi(
      <SecurityScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />,
      h.ui,
      "en",
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete vault" }));
    expect(screen.getByText("The vault is deleted from all your synced devices.")).toBeTruthy();
  });

  it("lands on the locked state when the other area still holds a vault after deleting", async () => {
    const { p, ui, onChanged } = await open();
    await Vault.create(
      { storage: p.sync, random: p.random, clock: p.clock, kdf: p.kdf },
      { password: PASSWORD, createRecoveryCode: false },
    );
    const danger = region("Tehlikeli bölge");
    await userEvent.click(within(danger).getByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(within(danger).getByLabelText("Onaylamak için SİL yaz"), "SİL");
    await confirmPassword(danger, "Kasayı kalıcı olarak sil");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await ui.rpc("getState", {})).toMatchObject({ status: "locked", storageArea: "sync" });
  });

  it("locks every other row while a fresh recovery code is pending", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Yeni kod oluştur" }));
    await confirmPassword(access, "Oluştur");
    await within(access).findByTestId("recovery-code");
    expect(within(access).getByRole("combobox", { name: "Kilit tercihi" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(access).getByRole("button", { name: "Parolayı değiştir" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(region("Pano ve gizli anahtarlar")).getByRole("switch")).toHaveProperty(
      "disabled",
      true,
    );
    const del = within(region("Tehlikeli bölge")).getByRole("button", { name: "Kasayı sil" });
    expect(del).toHaveProperty("disabled", true);
    await userEvent.click(del);
    expect(within(access).getByTestId("recovery-code")).toBeTruthy();
    expect(screen.getByText("Önce yeni kurtarma kodunu kaydet.")).toBeTruthy();
    await userEvent.click(
      within(access).getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(within(access).getByRole("button", { name: "Tamam" }));
    await screen.findByText("Yeni kurtarma kodu kaydedildi.");
    expect(del).toHaveProperty("disabled", false);
  });

  it("starts with empty password fields after a successful change", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await userEvent.type(within(access).getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(
      within(access).getByLabelText("Parolayı tekrar gir"),
      "yeni parola cümlesi",
    );
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await confirmPassword(access, "Parolayı değiştir");
    await screen.findByText("Parola değiştirildi.");
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    expect(within(access).getByLabelText("Yeni ana parola")).toHaveProperty("value", "");
    expect(within(access).getByLabelText("Parolayı tekrar gir")).toHaveProperty("value", "");
  });

  it("uses a sync-specific delete hint for the sync area", async () => {
    const sync = await harness({ storageArea: "sync" });
    const { unmount } = renderUi(
      <SecurityScreen state={await sync.ui.rpc("getState", {})} onChanged={() => {}} />,
      sync.ui,
    );
    const danger = region("Tehlikeli bölge");
    expect(
      within(danger).getByText(/eşitlenen tüm cihazlardan kalıcı olarak silinir/),
    ).toBeTruthy();
    expect(within(danger).queryByText(/bu cihazdan/)).toBeNull();
    unmount();
    const local = await harness();
    renderUi(
      <SecurityScreen state={await local.ui.rpc("getState", {})} onChanged={() => {}} />,
      local.ui,
    );
    expect(within(region("Tehlikeli bölge")).getByText(/bu cihazdan/)).toBeTruthy();
  });

  it("moves focus back to the row action after a change", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.selectOptions(
      within(access).getByRole("combobox", { name: "Kilit tercihi" }),
      "timeout-15",
    );
    await confirmPassword(access, "Kaydet");
    await screen.findByText("Kaydedildi.");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(access).getByRole("combobox", { name: "Kilit tercihi" }),
      ),
    );
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await userEvent.type(within(access).getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(
      within(access).getByLabelText("Parolayı tekrar gir"),
      "yeni parola cümlesi",
    );
    await userEvent.click(within(access).getByRole("button", { name: "Parolayı değiştir" }));
    await confirmPassword(access, "Parolayı değiştir");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        within(access).getByRole("button", { name: "Parolayı değiştir" }),
      ),
    );
  });

  it("accepts a decomposed (NFD) confirmation word", async () => {
    const { ui } = await open();
    const danger = region("Tehlikeli bölge");
    await userEvent.click(within(danger).getByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(within(danger).getByLabelText("Ana parola"), PASSWORD);
    await userEvent.type(
      within(danger).getByLabelText("Onaylamak için S\u0130L yaz"),
      "SI\u0307L ",
    );
    const submit = within(danger).getByRole("button", { name: "Kasayı kalıcı olarak sil" });
    expect(submit).toHaveProperty("disabled", false);
    await userEvent.click(submit);
    await vi.waitFor(async () => expect((await ui.rpc("getState", {})).status).toBe("no-vault"));
  });
  it("changes clipboard clearing without a password", async () => {
    const { service, onChanged } = await open();
    const display = region("Pano ve gizli anahtarlar");
    const select = within(display).getByLabelText("Panoyu temizle") as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("1 dk sonra");
    await userEvent.selectOptions(select, "30 sn sonra");
    expect(await screen.findByText("Kaydedildi.")).toBeTruthy();
    expect((await service.getState()).clipboardClearSec).toBe(30);
    expect(onChanged).toHaveBeenCalled();
    expect(within(display).queryByLabelText("Ana parola")).toBeNull();
  });

  it("warns about an unconfirmed recovery code and confirms it", async () => {
    const h = await harness();
    function Host({ initial }: { initial: ServiceState }) {
      const [state, setState] = useState(initial);
      return (
        <SecurityScreen state={state} onChanged={() => void h.service.getState().then(setState)} />
      );
    }
    renderUi(<Host initial={await h.service.getState()} />, h.ui);
    const notice = warningNotice().parentElement!;
    await userEvent.click(within(notice).getByRole("button", { name: "Kaydettim" }));
    expect(await screen.findByText("Kurtarma kodunun kaydedildiği onaylandı.")).toBeTruthy();
    await vi.waitFor(async () => {
      expect((await h.service.getState()).recoveryCodeConfirmed).toBe(true);
      expect(screen.queryByText(WARNING)).toBeNull();
    });
  });

  it("hides the warning once the state reports the code as confirmed", async () => {
    const h = await harness();
    await h.service.confirmRecoveryCode();
    await open(h);
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("the warning's new-code button opens the recovery panel", async () => {
    await open();
    await userEvent.click(
      within(warningNotice().parentElement!).getByRole("button", {
        name: "Yeni kod oluştur",
      }),
    );
    expect(await screen.findByText("Yeni kod oluşturunca eskisi geçersiz olur.")).toBeTruthy();
  });

  it("disables the clipboard select and hides the warning while a new code is pending", async () => {
    await open();
    const access = region("Erişim");
    await userEvent.click(within(access).getByRole("button", { name: "Yeni kod oluştur" }));
    await confirmPassword(access, "Oluştur");
    await within(access).findByTestId("recovery-code");
    expect(screen.queryByText(WARNING)).toBeNull();
    const display = region("Pano ve gizli anahtarlar");
    expect(within(display).getByLabelText("Panoyu temizle")).toHaveProperty("disabled", true);
  });

  it("numbers the sections 01 to 03 and no longer shows preference rows", async () => {
    await open();
    ["Erişim", "Pano ve gizli anahtarlar", "Tehlikeli bölge"].forEach((title, i) => {
      expect(within(region(title)).getByText(`0${i + 1}`)).toBeTruthy();
    });
    for (const label of ["Tema", "Dil", "Kod görünümü", "Açılış biçimi", "Popup boyutu"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText("Saat kontrolü")).toBeNull();
    expect(screen.queryByText("Kilitleme kısayolu")).toBeNull();
  });

  it("no warning without a recovery code", async () => {
    await open(await harness({ recoveryCode: false }));
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
