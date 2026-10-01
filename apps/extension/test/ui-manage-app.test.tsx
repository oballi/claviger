// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { RpcError } from "../src/rpc/client";
import type { UiPlatform } from "../src/ui/platform";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManageApp, parseRoute } from "../src/ui/manage/ManageApp";
import { harness, renderUi, withStatus } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

beforeEach(() => {
  window.location.hash = "";
});

const ACME = "otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

describe("parseRoute", () => {
  it("reads both hash styles and ignores unknown routes", () => {
    expect(parseRoute("#/security")).toBe("security");
    expect(parseRoute("#backup")).toBe("backup");
    expect(parseRoute("#/nope")).toBeNull();
    expect(parseRoute("")).toBeNull();
  });
});

describe("ManageApp", () => {
  it("starts the setup wizard when there is no vault", async () => {
    const { ui } = await harness({ status: "no-vault" });
    renderUi(<ManageApp pollMs={0} />, ui);
    expect(await screen.findByRole("heading", { name: "Ana parolanı belirle." })).toBeTruthy();
  });

  it("keeps the setup recovery code on screen while polling sees the vault unlocked", async () => {
    const { ui } = await harness({ status: "no-vault" });
    renderUi(<ManageApp pollMs={20} />, ui);
    await userEvent.type(await screen.findByLabelText("Ana parola"), "kirmizi bisiklet ruzgar");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "kirmizi bisiklet ruzgar");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
    expect((await ui.rpc("getState", {})).status).toBe("unlocked");
  });

  it("keeps the setup recovery code when one status poll fails", async () => {
    const { ui } = await harness({ status: "no-vault" });
    let failNext = false;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "getState" && failNext) {
        failNext = false;
        throw new RpcError("no-response", "worker restarting");
      }
      return ui.rpc(type, payload);
    };
    renderUi(<ManageApp pollMs={20} />, { ...ui, rpc });
    await userEvent.type(await screen.findByLabelText("Ana parola"), "kirmizi bisiklet ruzgar");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "kirmizi bisiklet ruzgar");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    failNext = true;
    await vi.waitFor(() => expect(failNext).toBe(false));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
  });

  it("keeps the code through a lock during setup, then ends on the lock screen", async () => {
    const { ui, service } = await harness({ status: "no-vault" });
    renderUi(<ManageApp pollMs={20} />, ui);
    await userEvent.type(await screen.findByLabelText("Ana parola"), "kirmizi bisiklet ruzgar");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "kirmizi bisiklet ruzgar");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    await service.lock();
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    expect(
      await screen.findByRole("heading", { name: "Kasan ne zaman kilitlensin?" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Hiçbir zaman" }));
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
  });

  it("asks for the password of a vault found through sync", async () => {
    const { ui } = await harness({ status: "locked" });
    window.location.hash = "#/setup";
    renderUi(<ManageApp pollMs={0} />, ui);
    expect(await screen.findByRole("heading", { name: "Kasan bulundu." })).toBeTruthy();
  });

  it("goes from the lock screen to recovery and keeps the new code on screen while polling", async () => {
    const { ui, recoveryCode } = await harness({ status: "locked" });
    renderUi(<ManageApp pollMs={20} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Parolamı unuttum" }));
    expect(window.location.hash).toBe("#/recover");
    await userEvent.type(await screen.findByLabelText("Kurtarma kodu"), recoveryCode!);
    await userEvent.type(screen.getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "yeni parola cümlesi");
    await userEvent.click(screen.getByRole("button", { name: "Kasayı aç" }));
    await screen.findByTestId("recovery-code");
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kodu güvenli bir yere kaydettim." }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Kodlarıma git" }));
    expect(await screen.findByRole("heading", { name: "Hesaplar." })).toBeTruthy();
    expect(window.location.hash).toBe("#/accounts");
  });

  it("navigates between sections and locks from the top bar", async () => {
    const { ui } = await harness();
    renderUi(<ManageApp pollMs={0} />, ui);
    expect(await screen.findByRole("heading", { name: "Hesaplar." })).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "Güvenlik" }));
    expect(await screen.findByRole("heading", { name: "Güvenlik." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Güvenlik" }).getAttribute("aria-current")).toBe(
      "page",
    );
    await userEvent.click(screen.getByRole("link", { name: "Yedekleme" }));
    expect(await screen.findByRole("heading", { name: "Yedekleme." })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Kilitle" }));
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Ana parola"), `${PASSWORD}{Enter}`);
    expect(await screen.findByRole("heading", { name: "Yedekleme." })).toBeTruthy();
  });

  it("imports from the backup page through the preview", async () => {
    const { ui } = await harness();
    window.location.hash = "#/backup";
    renderUi(<ManageApp pollMs={0} />, ui);
    await userEvent.upload(await screen.findByLabelText("Dosya seç"), new File([ACME], "a.txt"));
    expect(
      await screen.findByRole("heading", { name: "Aktarılacakları kontrol et." }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Yedekleme" }).getAttribute("aria-current")).toBe(
      "page",
    );
    await userEvent.click(screen.getByRole("button", { name: "1 hesabı ekle" }));
    await userEvent.click(await screen.findByRole("button", { name: "Hesaplara git" }));
    expect(await screen.findByText("Acme")).toBeTruthy();
  });

  it("shows the backup page when the import route has nothing to preview", async () => {
    const { ui } = await harness();
    window.location.hash = "#/import";
    renderUi(<ManageApp pollMs={0} />, ui);
    expect(await screen.findByRole("heading", { name: "Yedekleme." })).toBeTruthy();
  });

  it("switches to the lock screen when the vault locks while open", async () => {
    const { ui, service } = await harness();
    renderUi(<ManageApp pollMs={20} />, ui);
    await screen.findByRole("heading", { name: "Hesaplar." });
    await service.lock();
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
  });

  it("returns to setup after the vault is deleted", async () => {
    const { ui } = await harness();
    window.location.hash = "#/security";
    renderUi(<ManageApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(screen.getByLabelText("Onaylamak için SİL yaz"), "SİL");
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Kasayı kalıcı olarak sil" }));
    expect(await screen.findByRole("heading", { name: "Ana parolanı belirle." })).toBeTruthy();
  });

  it("shows the lock screen with the found title when the other area still holds a vault after deletion", async () => {
    const { ui, p } = await harness();
    // A second vault in sync: deleting the local one adopts it as a locked vault.
    for (const [key, value] of p.local.data) p.sync.data.set(key, value);
    window.location.hash = "#/security";
    renderUi(<ManageApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(screen.getByLabelText("Onaylamak için SİL yaz"), "SİL");
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Kasayı kalıcı olarak sil" }));
    expect(await screen.findByRole("heading", { name: "Kasan bulundu." })).toBeTruthy();
    expect((await ui.rpc("getState", {})).status).toBe("locked");
  });

  it("explains a damaged vault without offering destructive actions", async () => {
    const { ui } = await harness();
    renderUi(<ManageApp pollMs={0} />, withStatus(ui, "corrupt"));
    expect(await screen.findByText(/Verilerin silinmedi/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("explains a vault from a newer version", async () => {
    const { ui } = await harness();
    renderUi(<ManageApp pollMs={0} />, withStatus(ui, "unsupported"));
    expect(await screen.findByRole("heading", { name: "Güncelleme gerekli." })).toBeTruthy();
  });
});
