// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { RpcError } from "@claviger/ui/rpc-client";
import type { UiPlatform } from "@claviger/ui";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManageApp, parseRoute } from "@claviger/ui/manage";
import { harness, renderUi, withStatus } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

beforeEach(() => {
  window.location.hash = "";
});

/** Wraps rpc so a test can wait until polling has actually observed a given status. */
function countStatuses(ui: UiPlatform) {
  const seen: Record<string, number> = {};
  const rpc: UiPlatform["rpc"] = async (type, payload) => {
    const result = await ui.rpc(type, payload);
    if (type === "getState") {
      const status = (result as { status: string }).status;
      seen[status] = (seen[status] ?? 0) + 1;
    }
    return result;
  };
  return { seen, ui: { ...ui, rpc } };
}

const ACME = "otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

describe("parseRoute", () => {
  it("reads both hash styles and ignores unknown routes", () => {
    expect(parseRoute("#/security")).toBe("security");
    expect(parseRoute("#/preferences")).toBe("preferences");
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
    const { ui: base } = await harness({ status: "no-vault" });
    const { seen, ui } = countStatuses(base);
    renderUi(<ManageApp pollMs={20} />, ui);
    await userEvent.type(await screen.findByLabelText("Ana parola"), "kirmizi bisiklet ruzgar");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "kirmizi bisiklet ruzgar");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    const before = seen["unlocked"] ?? 0;
    await vi.waitFor(() => expect((seen["unlocked"] ?? 0) - before).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
  });

  it("keeps the setup recovery code when one status poll fails", async () => {
    const { ui: base } = await harness({ status: "no-vault" });
    const { seen, ui } = countStatuses(base);
    // Polls keep failing until released, so the banner stays up long enough to assert on.
    let failing = false;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "getState" && failing) {
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
    const before = seen["unlocked"] ?? 0;
    failing = true;
    expect(await screen.findByText("Eklentinin arka planına ulaşılamadı.")).toBeTruthy();
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
    failing = false;
    await vi.waitFor(() => expect((seen["unlocked"] ?? 0) - before).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("recovery-code")).toBeTruthy();
  });

  it("keeps the code through a lock during setup, then ends on the lock screen", async () => {
    const { ui: base, service } = await harness({ status: "no-vault" });
    const { seen, ui } = countStatuses(base);
    renderUi(<ManageApp pollMs={20} />, ui);
    await userEvent.type(await screen.findByLabelText("Ana parola"), "kirmizi bisiklet ruzgar");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "kirmizi bisiklet ruzgar");
    await userEvent.click(screen.getByRole("button", { name: "Devam" }));
    await userEvent.click(screen.getByRole("button", { name: "Kod oluştur" }));
    await screen.findByTestId("recovery-code");
    await service.lock();
    await vi.waitFor(() => expect(seen["locked"] ?? 0).toBeGreaterThanOrEqual(2));
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
    const { ui: base, recoveryCode } = await harness({ status: "locked" });
    const { seen, ui } = countStatuses(base);
    renderUi(<ManageApp pollMs={20} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Parolamı unuttum" }));
    expect(window.location.hash).toBe("#/recover");
    await userEvent.type(await screen.findByLabelText("Kurtarma kodu"), recoveryCode!);
    await userEvent.type(screen.getByLabelText("Yeni ana parola"), "yeni parola cümlesi");
    await userEvent.type(screen.getByLabelText("Parolayı tekrar gir"), "yeni parola cümlesi");
    await userEvent.click(screen.getByRole("button", { name: "Kasayı aç" }));
    await screen.findByTestId("recovery-code");
    const before = seen["unlocked"] ?? 0;
    await vi.waitFor(() => expect((seen["unlocked"] ?? 0) - before).toBeGreaterThanOrEqual(2));
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

  it("orders the tabs and serves the preferences route", async () => {
    const { ui } = await harness();
    window.location.hash = "#/preferences";
    renderUi(<ManageApp pollMs={0} />, ui);
    expect(await screen.findByRole("heading", { name: "Tercihler." })).toBeTruthy();
    const nav = screen.getByRole("navigation");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Hesaplar", "Tercihler", "Güvenlik", "Yedekleme"]);
    expect(screen.getByRole("link", { name: "Tercihler" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeTruthy();
    expect(screen.queryByText("Ana parola")).toBeNull();
  });

  it("keeps the same wide frame on every menu page", async () => {
    const { ui } = await harness();
    renderUi(<ManageApp pollMs={0} />, ui);
    const frame = async () => (await screen.findByRole("main")).parentElement as HTMLElement;
    await screen.findByRole("heading", { name: "Hesaplar." });
    expect((await frame()).className).toContain("max-w-[1240px]");
    for (const [link, heading] of [
      ["Tercihler", "Tercihler."],
      ["Güvenlik", "Güvenlik."],
      ["Yedekleme", "Yedekleme."],
    ]) {
      await userEvent.click(screen.getByRole("link", { name: link }));
      await screen.findByRole("heading", { name: heading });
      expect((await frame()).className).toContain("max-w-[1240px]");
    }
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

  it("never flashes the accounts page between deleting the vault and the next screen", async () => {
    const { ui: base } = await harness();
    // A slow status refresh, like a real worker round trip, gives a wrong intermediate render time to commit.
    let deleted = false;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "getState" && deleted) await new Promise((r) => setTimeout(r, 50));
      const result = await base.rpc(type, payload);
      if (type === "deleteVault") deleted = true;
      return result;
    };
    const ui = { ...base, rpc };
    window.location.hash = "#/security";
    renderUi(<ManageApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Kasayı sil" }));
    await userEvent.type(screen.getByLabelText("Onaylamak için SİL yaz"), "SİL");
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    const headings = new Set<string>();
    const record = () =>
      document.querySelectorAll("h1").forEach((h) => headings.add(h.textContent ?? ""));
    const observer = new MutationObserver(record);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    await userEvent.click(screen.getByRole("button", { name: "Kasayı kalıcı olarak sil" }));
    await screen.findByRole("heading", { name: "Ana parolanı belirle." });
    record();
    observer.disconnect();
    expect(headings.has("Hesaplar.")).toBe(false);
  });

  it("leaves the found route for the accounts page after unlocking", async () => {
    const { ui } = await harness({ status: "locked" });
    window.location.hash = "#/setup";
    renderUi(<ManageApp pollMs={0} />, ui);
    await userEvent.type(await screen.findByLabelText("Ana parola"), `${PASSWORD}{Enter}`);
    expect(await screen.findByRole("heading", { name: "Hesaplar." })).toBeTruthy();
    expect(window.location.hash).toBe("#/accounts");
  });

  it("drops a wizard that never started creating once another tab sets the vault up", async () => {
    const { ui, service } = await harness({ status: "no-vault" });
    renderUi(<ManageApp pollMs={20} />, ui);
    await screen.findByRole("heading", { name: "Ana parolanı belirle." });
    await service.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect(await screen.findByRole("heading", { name: "Hesaplar." })).toBeTruthy();
  });

  it("drops a recovery screen that never submitted once another tab unlocks the vault", async () => {
    const { ui, service, recoveryCode } = await harness({ status: "locked" });
    window.location.hash = "#/recover";
    renderUi(<ManageApp pollMs={20} />, ui);
    await screen.findByLabelText("Kurtarma kodu");
    await service.unlockWithRecovery(recoveryCode!, "yeni parola cümlesi");
    expect(await screen.findByRole("heading", { name: "Hesaplar." })).toBeTruthy();
  });

  it("forgets a pending import once the route leaves the import page", async () => {
    const { ui } = await harness();
    window.location.hash = "#/backup";
    renderUi(<ManageApp pollMs={0} />, ui);
    await userEvent.upload(await screen.findByLabelText("Dosya seç"), new File([ACME], "a.txt"));
    await screen.findByRole("heading", { name: "Aktarılacakları kontrol et." });
    await userEvent.click(screen.getByRole("link", { name: "Güvenlik" }));
    await screen.findByRole("heading", { name: "Güvenlik." });
    await userEvent.click(screen.getByRole("link", { name: "Yedekleme" }));
    await screen.findByRole("heading", { name: "Yedekleme." });
    window.location.hash = "#/import";
    expect(await screen.findByRole("heading", { name: "Yedekleme." })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Aktarılacakları kontrol et." })).toBeNull();
  });

  it("still shows the lock screen when the lock request itself fails", async () => {
    const { ui } = await harness();
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      const result = await ui.rpc(type, payload);
      if (type === "lock") throw new RpcError("no-response", "worker restarting");
      return result;
    };
    renderUi(<ManageApp pollMs={0} />, { ...ui, rpc });
    await userEvent.click(await screen.findByRole("button", { name: "Kilitle" }));
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
  });

  it("explains a damaged vault and offers the typed move-aside", async () => {
    const { ui } = await harness();
    renderUi(<ManageApp pollMs={0} />, withStatus(ui, "corrupt"));
    expect(await screen.findByText(/Verilerin silinmedi/)).toBeTruthy();
    expect(await screen.findByText(/kenara alıp yeni bir kasa/)).toBeTruthy();
    expect(screen.getByLabelText("Onaylamak için KENARA AL yaz")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kenara al ve yeni kasa kur" })).toBeTruthy();
  });

  it("explains a vault from a newer version", async () => {
    const { ui } = await harness();
    renderUi(<ManageApp pollMs={0} />, withStatus(ui, "unsupported"));
    expect(await screen.findByRole("heading", { name: "Güncelleme gerekli." })).toBeTruthy();
    expect(screen.queryByText(/kenara alıp yeni bir kasa/)).toBeNull();
  });
});
