// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportScreen } from "../src/ui/manage/ImportScreen";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const ACME = "otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const BANK = "otpauth://totp/Bank:ali?secret=GEZDGNBVGY3TQOJQ&issuer=Bank";
const BROKEN = "otpauth://totp/Broken:x?secret=not-base32!";

async function open(text: string, name: string | null = "codes.txt", h?: Harness) {
  const hh = h ?? (await harness());
  const onDone = vi.fn();
  const onCancel = vi.fn();
  renderUi(<ImportScreen source={{ text, name }} onDone={onDone} onCancel={onCancel} />, hh.ui);
  return { ...hh, onDone, onCancel };
}

describe("ImportScreen", () => {
  it("previews entries with counts, lists problems as rows and imports only the selection", async () => {
    const { ui, onDone } = await open([ACME, BANK, BROKEN].join("\n"));
    expect(await screen.findByText(/· otpauth:\/\/ listesi$/)).toBeTruthy();
    expect(screen.getByText("codes.txt")).toBeTruthy();
    const counts = screen.getByText("yeni hesap").parentElement!;
    expect(within(counts).getByText("2")).toBeTruthy();
    const table = screen.getByRole("table", { name: "İçe aktarılacak hesaplar" });
    const broken = within(table).getByText("Broken:x").closest("tr")!;
    expect(within(broken).getByText("Kurulum anahtarı geçersiz")).toBeTruthy();
    expect(within(broken).getByRole("checkbox")).toHaveProperty("disabled", true);

    await userEvent.click(screen.getByRole("checkbox", { name: "Bank (ali) hesabını seç" }));
    await userEvent.click(screen.getByRole("button", { name: "1 hesabı ekle" }));
    expect(await screen.findByText("1 hesap eklendi, 0 kopya atlandı.")).toBeTruthy();
    expect((await ui.rpc("listAccounts", {})).accounts.map((a) => a.issuer)).toEqual(["Acme"]);
    await userEvent.click(screen.getByRole("button", { name: "Hesaplara git" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("marks accounts that are already in the vault", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountUri", { uri: ACME });
    await open(ACME, null, h);
    const row = (await screen.findByRole("cell", { name: "Zaten kayıtlı" })).closest("tr")!;
    expect(within(row).getByRole("checkbox")).toHaveProperty("disabled", true);
    expect(within(row).getByRole("checkbox")).toHaveProperty("checked", false);
    expect(screen.getByText("Yapıştırılan metin")).toBeTruthy();
    expect(screen.getByRole("button", { name: "0 hesabı ekle" })).toHaveProperty("disabled", true);
  });

  it("asks for the password of an encrypted backup", async () => {
    const source = await harness();
    await source.ui.rpc("addAccountUri", { uri: BANK });
    const { token } = await source.ui.rpc("reauth", { password: PASSWORD });
    const backup = await source.ui.rpc("exportVault", {
      token,
      format: "otpvault",
      exportPassword: "backup password",
    });
    await open(backup.content, backup.filename);
    const field = await screen.findByLabelText("Dosya parolası");
    expect(screen.getByText("otp-vault yedeği parola ile korunuyor.")).toBeTruthy();
    await userEvent.type(field, "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Parola yanlış."));
    await userEvent.type(field, "backup password");
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    expect(await screen.findByText(/· otp-vault yedeği · şifresi çözüldü$/)).toBeTruthy();
  });

  it("explains unrecognized content and goes back", async () => {
    const { onCancel } = await open("hello");
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/^Bu içerik tanınmadı/),
    );
    await userEvent.click(screen.getByRole("button", { name: "Başka dosya seç" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("asks to start over when the preview has expired", async () => {
    const { p } = await open(ACME);
    await screen.findByRole("button", { name: "1 hesabı ekle" });
    p.clock.advance(11 * 60_000);
    await userEvent.click(screen.getByRole("button", { name: "1 hesabı ekle" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Önizlemenin süresi doldu. Dosyayı tekrar seç.",
      ),
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Başka dosya seç" })).toBeTruthy();
  });

  it("links back to the accounts page", async () => {
    await open(ACME);
    const crumb = screen.getByRole("navigation", { name: "Konum" });
    expect(within(crumb).getByRole("link", { name: "otp-vault" }).getAttribute("href")).toBe(
      "#/accounts",
    );
  });

  it("never renders secrets", async () => {
    await open([ACME, BANK].join("\n"));
    await screen.findByRole("table");
    expect(document.body.innerHTML).not.toContain("JBSWY3DPEHPK3PXP");
    expect(document.body.innerHTML).not.toContain("GEZDGNBVGY3TQOJQ");
  });

  it("clears the file password after a failed attempt", async () => {
    const source = await harness();
    await source.ui.rpc("addAccountUri", { uri: BANK });
    const { token } = await source.ui.rpc("reauth", { password: PASSWORD });
    const backup = await source.ui.rpc("exportVault", {
      token,
      format: "otpvault",
      exportPassword: "backup password",
    });
    await open(backup.content, backup.filename);
    const field = await screen.findByLabelText("Dosya parolası");
    await userEvent.type(field, "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Aç" }));
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Parola yanlış."));
    expect(screen.getByLabelText("Dosya parolası")).toHaveProperty("value", "");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("counts new, duplicate and broken entries separately", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountUri", { uri: ACME });
    const third = "otpauth://totp/Mail:cy?secret=MFRGGZDFMZTWQ2LK&issuer=Mail";
    await open([ACME, BANK, third, BROKEN].join("\n"), "codes.txt", h);
    await screen.findByRole("table");
    for (const [label, n] of [
      ["yeni hesap", "2"],
      ["zaten kayıtlı", "1"],
      ["aktarılamıyor", "1"],
    ] as const) {
      expect(within(screen.getByText(label).parentElement!).getByText(n)).toBeTruthy();
    }
  });

  it("shows type labels, status dots and keeps issuer/label cells on error rows", async () => {
    const steam = "otpauth://steam/Valve:gabe?secret=JBSWY3DPEHPK3PXP&issuer=Valve";
    await open([ACME, steam, BROKEN].join("\n"));
    const table = await screen.findByRole("table");
    const valve = within(table).getByText("Valve").closest("tr")!;
    expect(within(valve).getByText("Steam")).toBeTruthy();
    expect(
      within(table).getByText("Acme").closest("tr")!.querySelector("[aria-hidden]"),
    ).toBeTruthy();
    const broken = within(table).getByText("Broken:x").closest("tr")!;
    expect(broken.querySelectorAll("td")).toHaveLength(5);
    expect(broken.querySelector("td[colspan]")).toBeNull();
    expect(broken.querySelector("td:last-child [aria-hidden=true]")).toBeTruthy();
    const dot = (row: Element) => row.querySelector("td:last-child [aria-hidden=true]")!.className;
    expect(dot(valve)).not.toBe(dot(broken));
  });
});
