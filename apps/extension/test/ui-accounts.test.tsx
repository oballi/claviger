// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountsScreen } from "../src/ui/manage/AccountsScreen";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";

async function seeded() {
  const h = await harness();
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub&algorithm=SHA256&digits=8&period=60`,
    sourceUrl: "https://github.com",
  });
  await h.ui.rpc("addAccountManual", {
    draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "Bank", label: "ali" },
  });
  await h.ui.rpc("addAccountManual", { draft: { secret: "MFRGGZDFMZTWQ2LK", issuer: "Deno" } });
  return h;
}

async function open(h: Harness) {
  const onChanged = vi.fn();
  renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={onChanged} />, h.ui);
  await screen.findByText("GitHub");
  return onChanged;
}

const names = async (h: Harness) =>
  (await h.ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer);

describe("AccountsScreen", () => {
  it("lists accounts with linked sites, types and the summary strip", async () => {
    const h = await seeded();
    await open(h);
    expect(screen.getByRole("heading", { name: "Hesaplar." }).parentElement?.textContent).toContain(
      "3",
    );
    const row = screen.getByText("GitHub").closest("tr")!;
    expect(within(row).getByText("github.com")).toBeTruthy();
    expect(within(row).getByText("TOTP")).toBeTruthy();
    expect(within(screen.getByText("Bank").closest("tr")!).getByText("bağlı değil")).toBeTruthy();
    expect(screen.getByText("Tarayıcı kapanınca")).toBeTruthy();
    expect(screen.getByText("Yalnızca bu cihaz")).toBeTruthy();
    expect(screen.getByText("Henüz yedek alınmadı")).toBeTruthy();
  });

  it("filters by service, account or site", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.type(screen.getByRole("searchbox", { name: "Hesap ara" }), "github.com");
    expect(screen.queryByText("Bank")).toBeNull();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Hesap ara" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Hesap ara" }), "zzz");
    expect(screen.getByText("Aramana uyan hesap yok.")).toBeTruthy();
  });

  it("adds an account from a dialog", async () => {
    const h = await harness();
    const onChanged = vi.fn();
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={onChanged} />, h.ui);
    expect(await screen.findByText("Henüz hesap yok.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Hesap ekle" }));
    const dialog = screen.getByRole("dialog", { name: "Hesap ekle." });
    await userEvent.type(
      within(dialog).getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.type(within(dialog).getByLabelText("Servis"), "Acme");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hesabı ekle" }));
    expect(await screen.findByText("Acme eklendi")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("edits issuer, label and linked sites, and shows algorithm, digits and period", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "GitHub hesabını düzenle" }));
    const dialog = screen.getByRole("dialog", { name: "GitHub" });
    expect(within(dialog).getByText("SHA256")).toBeTruthy();
    expect(within(dialog).getByText("8")).toBeTruthy();
    expect(within(dialog).getByText("60 sn")).toBeTruthy();
    const label = within(dialog).getByLabelText("Hesap");
    await userEvent.clear(label);
    await userEvent.type(label, "me@work");
    const issuer = within(dialog).getByLabelText("Servis");
    await userEvent.clear(issuer);
    await userEvent.type(issuer, "GitHub Work");
    const sites = within(dialog).getByLabelText("Siteler");
    await userEvent.clear(sites);
    await userEvent.type(sites, "login.github.com, gitlab.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText("GitHub Work kaydedildi.")).toBeTruthy();
    expect((await h.ui.rpc("listAccounts", {})).accounts[0]).toMatchObject({
      issuer: "GitHub Work",
      label: "me@work",
      domains: ["github.com", "gitlab.com"],
    });
  });

  it("pins and reorders within the same group", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Bank hesabını düzenle" }));
    await userEvent.click(screen.getByRole("button", { name: "Yukarı taşı" }));
    await vi.waitFor(async () => expect(await names(h)).toEqual(["Bank", "GitHub", "Deno"]));
    await screen.findByText("Bank taşındı.");
    await userEvent.click(screen.getByRole("button", { name: "Deno hesabını düzenle" }));
    await userEvent.click(screen.getByRole("button", { name: "Sabitle" }));
    await screen.findByText("Deno sabitlendi.");
    await userEvent.click(screen.getByRole("button", { name: "Deno hesabını düzenle" }));
    expect(screen.getByRole("button", { name: "Yukarı taşı" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Aşağı taşı" })).toHaveProperty("disabled", true);
  });

  it("deletes only after confirmation", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Deno hesabını düzenle" }));
    await userEvent.click(screen.getByRole("button", { name: "Sil" }));
    expect(await names(h)).toContain("Deno");
    await userEvent.click(screen.getByRole("button", { name: "Evet, sil" }));
    expect(await screen.findByText("Deno silindi.")).toBeTruthy();
    expect(await names(h)).toEqual(["GitHub", "Bank"]);
  });

  it("reveals the secret and QR after the password, or directly when the setting allows", async () => {
    const h = await seeded();
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "GitHub hesabını düzenle" }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    expect(await screen.findByRole("img", { name: "GitHub için QR kodu" })).toBeTruthy();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı kopyala" }));
    expect(h.ui.copy).toHaveBeenCalledWith(SECRET);
  });

  it("never puts the secret in the DOM or asks the service before the password is confirmed", async () => {
    const h = await seeded();
    const spy = vi.spyOn(h.service, "revealSecret");
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "GitHub hesabını düzenle" }));
    const text = () => document.body.innerHTML.replace(/\s/g, "");
    expect(text()).not.toContain(SECRET);
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    await screen.findByLabelText("Ana parola");
    expect(text()).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain("JBSW Y3DP");
    expect(screen.queryByRole("img", { name: "GitHub için QR kodu" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Ana parola"), "wrong password!");
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    await vi.waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByLabelText("Ana parola")).toBeTruthy(),
    );
    expect(text()).not.toContain(SECRET);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reveals without a password when the user turned that off", async () => {
    const h = await seeded();
    const { token } = await h.ui.rpc("reauth", { password: PASSWORD });
    await h.ui.rpc("setRevealRequiresPassword", { token, value: false });
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "GitHub hesabını düzenle" }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(await screen.findByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    expect(screen.queryByLabelText("Ana parola")).toBeNull();
  });

  it("falls back to the password when the service still requires it", async () => {
    const h = await seeded();
    const state = { ...(await h.ui.rpc("getState", {})), revealRequiresPassword: false };
    renderUi(<AccountsScreen state={state} onChanged={() => {}} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: "GitHub hesabını düzenle" }));
    await userEvent.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    expect(await screen.findByLabelText("Ana parola")).toBeTruthy();
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
  });

  it("repairs a damaged index and deletes unreadable entries after confirmation", async () => {
    const h = await seeded();
    h.p.local.data.set("vault:acct:broken", "garbage");
    h.p.local.data.set("vault:index", "garbage");
    await open(h);
    const box = screen.getByRole("region", { name: "Bakım gerekiyor." });
    await userEvent.click(within(box).getByRole("button", { name: "Hesap sırasını onar" }));
    await screen.findByText("Hesap sırası onarıldı.");
    await userEvent.click(within(box).getByRole("button", { name: "broken kaydını sil" }));
    await userEvent.click(within(box).getByRole("button", { name: "Evet, sil" }));
    await screen.findByText("Okunamayan kayıt silindi.");
    await vi.waitFor(() =>
      expect(screen.queryByRole("region", { name: "Bakım gerekiyor." })).toBeNull(),
    );
    expect(await h.ui.rpc("listAccounts", {})).toMatchObject({
      unreadable: [],
      indexDamaged: false,
    });
  });
});
