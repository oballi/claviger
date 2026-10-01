// @vitest-environment jsdom
import { generateCode } from "@otp-vault/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RpcError } from "../src/rpc/client";
import { formatCode } from "../src/ui/format";
import type { UiPlatform } from "../src/ui/platform";
import { PopupApp } from "../src/ui/popup/PopupApp";
import { harness, renderUi, withStatus } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const GITHUB = "JBSWY3DPEHPK3PXP";
const BANK = "GEZDGNBVGY3TQOJQ";
const STEAM = "MFRGGZDFMZTWQ2LK";

async function seeded(tabUrl?: string) {
  const h = await harness({ tabUrl });
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/GitHub:me?secret=${GITHUB}&issuer=GitHub`,
    sourceUrl: "https://github.com",
  });
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://hotp/Bank:ali?secret=${BANK}&issuer=Bank&counter=4`,
  });
  const steam = await h.ui.rpc("addAccountManual", {
    draft: { secret: STEAM, type: "steam", issuer: "Steam", label: "gamer" },
  });
  await h.ui.rpc("setPinned", { id: steam.id, pinned: true });
  const githubCode = (
    await generateCode(
      { type: "totp", secret: GITHUB, algorithm: "SHA1", digits: 6, period: 30, counter: 0 },
      h.p.clock.now(),
    )
  ).code;
  return { ...h, githubCode };
}

/** Overrides one RPC type; everything else reaches the real service. */
function override(ui: UiPlatform, type: string, impl: () => Promise<unknown>): UiPlatform {
  const rpc: UiPlatform["rpc"] = async (t, payload) =>
    t === type ? ((await impl()) as never) : ui.rpc(t, payload);
  return { ...ui, rpc };
}

describe("popup status screens", () => {
  it("sends a user without a vault to setup", async () => {
    const { ui } = await harness({ status: "no-vault" });
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Kurulumu başlat" }));
    expect(ui.openManage).toHaveBeenCalledWith("setup");
  });

  it("explains a vault from a newer version", async () => {
    const { ui } = await harness();
    renderUi(<PopupApp pollMs={0} />, withStatus(ui, "unsupported"));
    expect(await screen.findByRole("heading", { name: "Güncelleme gerekli." })).toBeTruthy();
  });

  it("opens the manage page for a damaged vault", async () => {
    const { ui } = await harness();
    renderUi(<PopupApp pollMs={0} />, withStatus(ui, "corrupt"));
    await userEvent.click(await screen.findByRole("button", { name: "Ayrıntılar" }));
    expect(ui.openManage).toHaveBeenCalledWith();
  });

  it("unlocks, and links the policy and recovery to the manage page", async () => {
    const { ui } = await harness({ status: "locked" });
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Değiştir" }));
    expect(ui.openManage).toHaveBeenCalledWith("security");
    await userEvent.click(screen.getByRole("button", { name: "Parolamı unuttum" }));
    expect(ui.openManage).toHaveBeenCalledWith("recover");
    await userEvent.type(screen.getByLabelText("Ana parola"), `${PASSWORD}{Enter}`);
    expect(await screen.findByText("Henüz hesap yok.")).toBeTruthy();
  });

  it("shows an error when the background does not answer", async () => {
    const { ui } = await harness();
    renderUi(
      <PopupApp pollMs={0} />,
      override(ui, "getState", async () => {
        throw new RpcError("no-response", "x");
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Eklentinin arka planına ulaşılamadı.",
    );
  });

  it("retries the first status request from the error screen", async () => {
    const { ui } = await harness();
    let fail = true;
    const rpc: UiPlatform["rpc"] = async (type, payload) => {
      if (type === "getState" && fail) throw new RpcError("no-response", "x");
      return ui.rpc(type, payload);
    };
    renderUi(<PopupApp pollMs={0} />, { ...ui, rpc });
    await screen.findByText("Eklentinin arka planına ulaşılamadı.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(await screen.findByText("Henüz hesap yok.")).toBeTruthy();
    expect(screen.queryByText("Eklentinin arka planına ulaşılamadı.")).toBeNull();
  });
});

describe("codes screen", () => {
  it("groups accounts into this site, pinned and the rest", async () => {
    const { ui, githubCode } = await seeded("https://github.com/login");
    renderUi(<PopupApp pollMs={0} />, ui);
    const site = await screen.findByRole("region", { name: "Bu site · github.com" });
    const copyGithub = within(site).getByRole("button", { name: /^GitHub kodunu kopyala/ });
    expect(copyGithub.textContent).toBe(formatCode(githubCode));
    expect(
      within(screen.getByRole("region", { name: "Sabitlenenler" })).getByText("Steam"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Tüm hesaplar" })).getByText("Bank"),
    ).toBeTruthy();
  });

  it("copies a code without spaces and confirms it", async () => {
    const { ui, githubCode } = await seeded();
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: /^GitHub kodunu kopyala/ }));
    expect(ui.copy).toHaveBeenCalledWith(githubCode);
    expect(screen.getByRole("status").textContent).toBe("GitHub kodu kopyalandı");
  });

  it("shows an error instead of failing silently when copying is refused", async () => {
    const { ui } = await seeded();
    ui.copy.mockRejectedValueOnce(new Error("clipboard denied"));
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: /^GitHub kodunu kopyala/ }));
    expect(await screen.findByText("Kopyalanamadı.")).toBeTruthy();
    expect(screen.queryByText("GitHub kodu kopyalandı")).toBeNull();
  });

  it("shows an error when locking fails", async () => {
    const { ui } = await seeded();
    renderUi(
      <PopupApp pollMs={0} />,
      override(ui, "lock", async () => {
        throw new RpcError("no-response", "x");
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Kilitle" }));
    expect(await screen.findByText("Eklentinin arka planına ulaşılamadı.")).toBeTruthy();
  });

  it("focuses search with / from the page body and filters", async () => {
    const { ui } = await seeded();
    renderUi(<PopupApp pollMs={0} />, ui);
    await screen.findByText("Bank");
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Hesap ara" }));
    await userEvent.keyboard("ban");
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Sonuçlar" })).getByText("Bank")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("GitHub")).toBeTruthy();
  });

  it("moves exactly one code per arrow key press", async () => {
    const { ui } = await seeded();
    renderUi(<PopupApp pollMs={0} />, ui);
    const first = await screen.findByRole("button", { name: /^Steam kodunu kopyala/ });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^GitHub kodunu/);
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Bank kodunu/);
  });

  it("generates the next HOTP code", async () => {
    const { ui } = await seeded();
    renderUi(<PopupApp pollMs={0} />, ui);
    const next = (
      await generateCode(
        { type: "hotp", secret: BANK, algorithm: "SHA1", digits: 6, period: 30, counter: 5 },
        0,
      )
    ).code;
    await userEvent.click(await screen.findByRole("button", { name: "Bank için yeni kod üret" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /^Bank kodunu kopyala/ }).textContent).toBe(
        formatCode(next),
      ),
    );
  });

  it("adds an account and returns to the list with a confirmation", async () => {
    const { ui } = await harness();
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Hesap ekle" }));
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      GITHUB,
    );
    await userEvent.type(screen.getByLabelText("Servis"), "GitHub");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    expect(await screen.findByText("GitHub eklendi")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^GitHub kodunu kopyala/ })).toBeTruthy();
  });

  it("locks from the header", async () => {
    const { ui } = await seeded();
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(await screen.findByRole("button", { name: "Kilitle" }));
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
  });

  it("switches to the lock screen when the vault locks while open", async () => {
    const { ui, service } = await seeded();
    renderUi(<PopupApp pollMs={20} />, ui);
    await screen.findByText("Bank");
    await service.lock();
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
    expect(screen.queryByText("Bank")).toBeNull();
  });

  it("shows an empty state, a damaged-data link and list errors", async () => {
    const { ui, p } = await harness();
    renderUi(<PopupApp pollMs={0} />, ui);
    expect(await screen.findByText("Henüz hesap yok.")).toBeTruthy();
    p.local.data.set("vault:acct:broken", "garbage");
    renderUi(<PopupApp pollMs={0} />, ui);
    await userEvent.click(
      await screen.findByRole("button", { name: "Bazı hesaplar okunamadı. Ayrıntılar" }),
    );
    expect(ui.openManage).toHaveBeenCalledWith("accounts");
  });

  it("shows a list error that is not a lock", async () => {
    const { ui } = await harness();
    renderUi(
      <PopupApp pollMs={0} />,
      override(ui, "listAccounts", async () => {
        throw new RpcError("internal", "boom");
      }),
    );
    expect((await screen.findByText("Beklenmeyen bir hata oluştu.")).getAttribute("role")).toBe(
      "alert",
    );
  });

  it("warns when synced storage or its index item is nearly full", async () => {
    const { ui } = await harness();
    const usage = (bytes: number, indexBytes: number) =>
      override(ui, "storageUsage", async () => ({
        area: "sync",
        bytes,
        indexBytes,
        quotaBytes: 102_400,
        maxItemBytes: 8192,
      }));
    renderUi(<PopupApp pollMs={0} />, usage(86_000, 500));
    await userEvent.click(
      await screen.findByRole("button", { name: "Eşitleme alanı dolmak üzere (%84). Ayrıntılar" }),
    );
    expect(ui.openManage).toHaveBeenCalledWith("backup");
    renderUi(<PopupApp pollMs={0} />, usage(10_000, 7000));
    expect(
      await screen.findByRole("button", { name: "Eşitleme alanı dolmak üzere (%85). Ayrıntılar" }),
    ).toBeTruthy();
  });
});
