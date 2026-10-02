// @vitest-environment jsdom
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BackupScreen, type ImportSource, ImportScreen } from "@claviger/ui/manage";
import { encodeBinaryImport } from "@claviger/core";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";
import { migrationUri } from "./helpers/qr";
import { QrImageTooLargeError } from "@claviger/ui/qr-limits";

const ACME = "otpauth://totp/Acme:bob?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

async function open(h?: Harness) {
  const hh = h ?? (await harness());
  await hh.ui.rpc("addAccountUri", { uri: ACME });
  const onChanged = vi.fn();
  const onImport = vi.fn();
  renderUi(
    <BackupScreen
      state={await hh.ui.rpc("getState", {})}
      onChanged={onChanged}
      onImport={onImport}
    />,
    hh.ui,
  );
  return { ...hh, onChanged, onImport };
}

const region = (name: string) => screen.getByRole("region", { name });

async function confirmPassword(scope: HTMLElement, button: string, password = PASSWORD) {
  await userEvent.type(within(scope).getByLabelText("Ana parola"), password);
  await userEvent.click(within(scope).getByRole("button", { name: button }));
}

describe("BackupScreen export", () => {
  it("warns that there is no backup yet and how many accounts are at risk", async () => {
    await open();
    expect(screen.getByText("Henüz yedek alınmadı.")).toBeTruthy();
    expect(screen.getByText(/Bu cihazı kaybedersen 1 hesabın da gider/)).toBeTruthy();
  });

  it("lets the file picker choose .claviger and legacy .otpvault files", async () => {
    await open();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const accept = input.accept.split(",");
    expect(accept).toContain(".claviger");
    expect(accept).toContain(".otpvault");
  });

  it("downloads an encrypted backup protected by the vault password by default", async () => {
    const { ui, onChanged } = await open();
    const exporting = region("Dışa aktar");
    expect(within(exporting).getByText(/^claviger-\d{4}-\d{2}-\d{2}\.claviger$/)).toBeTruthy();
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    expect(await screen.findByText("Yedek indirildi: 1 hesap.")).toBeTruthy();
    const [filename, content] = ui.download.mock.calls[0]!;
    expect(filename).toMatch(/\.claviger$/);
    expect(await ui.rpc("importPreview", { text: content, password: PASSWORD })).toMatchObject({
      status: "ok",
    });
    expect(onChanged).toHaveBeenCalled();
    expect((await ui.rpc("getState", {})).lastBackupAt).not.toBeNull();
  });

  it("requires a confirmed custom backup password of at least 8 characters", async () => {
    const { ui } = await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Farklı bir parola kullan" }),
    );
    const download = within(exporting).getByRole("button", { name: "Yedeği indir" });
    await userEvent.type(within(exporting).getByLabelText("Yedek parolası"), "short");
    expect(download).toHaveProperty("disabled", true);
    await userEvent.type(within(exporting).getByLabelText("Yedek parolası"), " but now long");
    await userEvent.type(
      within(exporting).getByLabelText("Yedek parolasını tekrar gir"),
      "short but now lonG",
    );
    expect(within(exporting).getByText("Parolalar eşleşmiyor.")).toBeTruthy();
    expect(download).toHaveProperty("disabled", true);
    await userEvent.clear(within(exporting).getByLabelText("Yedek parolasını tekrar gir"));
    await userEvent.type(
      within(exporting).getByLabelText("Yedek parolasını tekrar gir"),
      "short but now long",
    );
    await userEvent.click(download);
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    const content = ui.download.mock.calls[0]![1];
    expect(
      await ui.rpc("importPreview", { text: content, password: "short but now long" }),
    ).toMatchObject({ status: "ok" });
    expect(within(exporting).getByRole("radio", { name: "Kasa parolasını kullan" })).toHaveProperty(
      "checked",
      true,
    );
    expect(within(exporting).queryByLabelText("Yedek parolası")).toBeNull();
  });

  it("requires an explicit acknowledgement before a plain-text export", async () => {
    const { ui } = await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Düz metin otpauth listesi" }),
    );
    expect(within(exporting).getByText(/^claviger-.*\.txt$/)).toBeTruthy();
    const download = within(exporting).getByRole("button", { name: "Yedeği indir" });
    expect(download).toHaveProperty("disabled", true);
    expect(within(exporting).queryByLabelText("Ana parola")).toBeNull();
    await userEvent.click(
      within(exporting).getByRole("checkbox", {
        name: "Gizli anahtarların açıkta olacağını anlıyorum",
      }),
    );
    await userEvent.click(download);
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    expect(ui.download.mock.calls[0]![1]).toContain("otpauth://totp/");
  });

  it("warns loudly when unreadable accounts were left out of the backup", async () => {
    const h = await harness();
    h.p.local.data.set("vault:acct:broken", "garbage");
    await open(h);
    const exporting = region("Dışa aktar");
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    expect(
      (await within(exporting).findByText(/Okunamayan 1 kayıt yedeğe girmedi/)).getAttribute(
        "role",
      ),
    ).toBe("alert");
  });

  it("shows the date of the last backup", async () => {
    const h = await harness();
    await h.ui.rpc("exportVault", {
      token: (await h.ui.rpc("reauth", { password: PASSWORD })).token,
      format: "otpauth",
    });
    await open(h);
    expect(screen.getByText(/^Son yedek: /)).toBeTruthy();
  });
});

describe("BackupScreen import", () => {
  it("passes a chosen file to the import preview", async () => {
    const { onImport } = await open();
    const file = new File([ACME], "codes.txt", { type: "text/plain" });
    await userEvent.upload(screen.getByLabelText("Dosya seç"), file);
    await vi.waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({ text: ACME, name: "codes.txt" }),
    );
  });

  it("sends a non-UTF-8 file as claviger-binary base64", async () => {
    const { onImport } = await open();
    const bytes = Uint8Array.from([0, 0, 3, 232, 0xff, 0xfe, 0x80, 0x90]);
    await userEvent.upload(screen.getByLabelText("Dosya seç"), new File([bytes], "b.json.aes"));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0]![0]).toEqual({
      text: encodeBinaryImport(bytes),
      name: "b.json.aes",
    });
  });

  it("refuses a binary file picked together with others", async () => {
    const { onImport } = await open();
    await userEvent.upload(screen.getByLabelText("Dosya seç"), [
      new File([Uint8Array.from([0xff, 0xfe])], "b.aes"),
      new File([ACME], "codes.txt"),
    ]);
    expect(await screen.findByText("İkili yedekleri (andOTP) tek tek seçin.")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("accepts a dropped file and pasted text", async () => {
    const { onImport } = await open();
    const file = new File([ACME], "drop.txt", { type: "text/plain" });
    fireEvent.drop(screen.getByText("Yedek dosyasını buraya bırak").parentElement!, {
      dataTransfer: { files: [file] },
    });
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith({ text: ACME, name: "drop.txt" }));
    await userEvent.click(screen.getByText("Metin yapıştır"));
    await userEvent.click(screen.getByLabelText("Yedek metni veya otpauth:// bağlantıları"));
    await userEvent.paste(ACME);
    await userEvent.click(screen.getByRole("button", { name: "Önizle" }));
    expect(onImport).toHaveBeenLastCalledWith({ text: ACME, name: null });
  });

  it("rejects files over 5 MB", async () => {
    const { onImport } = await open();
    await userEvent.upload(
      screen.getByLabelText("Dosya seç"),
      new File(["x".repeat(5_000_001)], "big.json"),
    );
    await vi.waitFor(() =>
      expect(screen.getByText("Dosya çok büyük (en fazla 5 MB).")).toBeTruthy(),
    );
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("BackupScreen QR images", () => {
  const BANK = "otpauth://totp/Bank:ali?secret=GEZDGNBVGY3TQOJQ&issuer=Bank";
  const MIGRATION = migrationUri([
    ["Acme", "carol", [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]],
    ["Shop", "eve", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ]);

  it("imports accounts from QR images, merging several files into one preview", async () => {
    const hh = await harness();
    await hh.ui.rpc("addAccountUri", { uri: ACME });
    const texts: Record<string, string[]> = { "export.png": [MIGRATION], "acme.png": [ACME] };
    hh.ui.decodeQr.mockImplementation(async (image) => texts[(image as File).name] ?? []);
    const state = await hh.ui.rpc("getState", {});
    function Wrapper() {
      const [source, setSource] = useState<ImportSource | null>(null);
      return source ? (
        <ImportScreen source={source} onDone={vi.fn()} onCancel={vi.fn()} />
      ) : (
        <BackupScreen state={state} onChanged={vi.fn()} onImport={setSource} />
      );
    }
    renderUi(<Wrapper />, hh.ui);
    await userEvent.upload(screen.getByLabelText("Dosya seç"), [
      new File(["x"], "export.png", { type: "image/png" }),
      new File(["x"], "acme.png", { type: "image/png" }),
    ]);
    const table = await screen.findByRole("table", { name: "İçe aktarılacak hesaplar" });
    expect(within(table).getAllByRole("checkbox")).toHaveLength(3);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.filter((r) => within(r).queryByText("Zaten kayıtlı"))).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Shop (eve) hesabını seç" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.getByRole("checkbox", { name: "Acme (bob) hesabını seç" })).toHaveProperty(
      "checked",
      false,
    );
    expect(hh.ui.decodeQr).toHaveBeenCalledTimes(2);
  });

  it("says when an image has no QR", async () => {
    const { ui, onImport } = await open();
    await userEvent.upload(
      screen.getByLabelText("Dosya seç"),
      new File(["x"], "blank.png", { type: "image/png" }),
    );
    expect(await screen.findByText("Bu görselde QR kod bulunamadı.")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
    ui.decodeQr.mockResolvedValue(["https://example.com", BANK.replace("otpauth", "nope")]);
    await userEvent.upload(
      screen.getByLabelText("Dosya seç"),
      new File(["x"], "web.png", { type: "image/png" }),
    );
    expect(await screen.findByText("QR bulundu ama 2FA kodu değil.")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("warns about images without a 2FA QR but still imports the rest", async () => {
    const hh = await harness();
    hh.ui.decodeQr.mockImplementation(async (image) =>
      (image as File).name === "good.png" ? [BANK] : [],
    );
    const state = await hh.ui.rpc("getState", {});
    function Wrapper() {
      const [source, setSource] = useState<ImportSource | null>(null);
      return source ? (
        <ImportScreen source={source} onDone={vi.fn()} onCancel={vi.fn()} />
      ) : (
        <BackupScreen state={state} onChanged={vi.fn()} onImport={setSource} />
      );
    }
    renderUi(<Wrapper />, hh.ui);
    await userEvent.upload(screen.getByLabelText("Dosya seç"), [
      new File(["x"], "good.png", { type: "image/png" }),
      new File(["x"], "blank.png", { type: "image/png" }),
    ]);
    expect(await screen.findByText("1 görselde 2FA QR'ı bulunamadı: blank.png")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Bank (ali) hesabını seç" })).toBeTruthy();
  });

  it("rejects more than 20 files", async () => {
    const { onImport, ui } = await open();
    await userEvent.upload(
      screen.getByLabelText("Dosya seç"),
      Array.from({ length: 21 }, (_, i) => new File(["x"], `${i}.png`, { type: "image/png" })),
    );
    expect(await screen.findByText("En fazla 20 dosya seçilebilir.")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
    expect(ui.decodeQr).not.toHaveBeenCalled();
  });

  it("reports images that are too large", async () => {
    const { ui } = await open();
    ui.decodeQr.mockRejectedValue(new QrImageTooLargeError());
    await userEvent.upload(
      screen.getByLabelText("Dosya seç"),
      new File(["x"], "huge.png", { type: "image/png" }),
    );
    expect(await screen.findByText("Görsel çok büyük.")).toBeTruthy();
  });
});

describe("BackupScreen pasted and dropped images", () => {
  const png = (name = "qr.png", size?: number) => {
    const file = new File(["x"], name, { type: "image/png" });
    if (size) Object.defineProperty(file, "size", { value: size });
    return file;
  };
  const paste = (files: File[], target: Element = document.body) =>
    fireEvent.paste(target, { clipboardData: { files, types: ["Files"] } });

  it("decodes an image pasted anywhere on the page", async () => {
    const hh = await harness();
    hh.ui.decodeQr.mockResolvedValue([ACME]);
    const { onImport } = await open(hh);
    paste([png()]);
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith({ text: ACME, name: "qr.png" }));
    expect(hh.ui.decodeQr).toHaveBeenCalledTimes(1);
  });

  it("leaves pastes into the text box alone", async () => {
    const { ui, onImport } = await open();
    await userEvent.click(screen.getByText("Metin yapıştır"));
    paste([png()], screen.getByLabelText("Yedek metni veya otpauth:// bağlantıları"));
    expect(ui.decodeQr).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("reports pasted images over the size limit", async () => {
    const { ui } = await open();
    paste([png("big.png", 20_000_001)]);
    expect(await screen.findByText("Görsel çok büyük.")).toBeTruthy();
    expect(ui.decodeQr).not.toHaveBeenCalled();
  });

  it("warns when a link is dropped instead of a file", async () => {
    const { onImport } = await open();
    fireEvent.drop(screen.getByText("Yedek dosyasını buraya bırak").parentElement!, {
      dataTransfer: { files: [] },
    });
    expect(await screen.findByText("Bağlantı değil, bir görsel dosyası bırakın.")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("BackupScreen storage", () => {
  it("moves the vault to browser sync after the password and shows the quota", async () => {
    const { ui, onChanged } = await open();
    const storage = region("Depolama");
    expect(within(storage).getByText("Yalnızca bu cihaz")).toBeTruthy();
    expect(await within(storage).findByText(/KB kullanılıyor$/)).toBeTruthy();
    await userEvent.click(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
    await confirmPassword(storage, "Taşı");
    expect(await screen.findByText("Kasa taşındı.")).toBeTruthy();
    expect(await within(storage).findByText(/KB \/ 100 KB kullanılıyor/)).toBeTruthy();
    expect((await ui.rpc("getState", {})).storageArea).toBe("sync");
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("BackupScreen hardening", () => {
  it("spends a fresh reauth token for every export", async () => {
    const h = await harness();
    const spy = vi.spyOn(h.ui, "rpc");
    await open(h);
    const exporting = region("Dışa aktar");
    for (let i = 0; i < 2; i++) {
      await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
      await confirmPassword(exporting, "İndir");
      await vi.waitFor(() => expect(h.ui.download).toHaveBeenCalledTimes(i + 1));
    }
    const tokens = spy.mock.calls
      .filter(([type]) => type === "exportVault")
      .map(([, payload]) => (payload as { token: string }).token);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(spy.mock.calls.filter(([type]) => type === "reauth")).toHaveLength(2);
  });

  it("encrypts with the custom password and not with the vault password", async () => {
    const { ui } = await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Farklı bir parola kullan" }),
    );
    await userEvent.type(within(exporting).getByLabelText("Yedek parolası"), "another long pass");
    await userEvent.type(
      within(exporting).getByLabelText("Yedek parolasını tekrar gir"),
      "another long pass",
    );
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    const content = ui.download.mock.calls[0]![1];
    const withVault = await ui.rpc("importPreview", { text: content, password: PASSWORD }).then(
      (r) => r.status,
      () => "error",
    );
    expect(withVault).not.toBe("ok");
    expect(
      await ui.rpc("importPreview", { text: content, password: "another long pass" }),
    ).toMatchObject({ status: "ok" });
  });

  it("hands the filename chosen by the service to the download", async () => {
    const h = await harness();
    const real = h.ui.rpc;
    h.ui.rpc = (async (type: string, payload: object) => {
      const result = await (real as (t: string, p: object) => Promise<object>)(type, payload);
      return type === "exportVault" ? { ...result, filename: "from-service.claviger" } : result;
    }) as typeof h.ui.rpc;
    await open(h);
    const exporting = region("Dışa aktar");
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    expect(h.ui.download.mock.calls[0]![0]).toBe("from-service.claviger");
  });

  it("clears typed backup passwords when the format changes", async () => {
    await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Farklı bir parola kullan" }),
    );
    await userEvent.type(within(exporting).getByLabelText("Yedek parolası"), "typed secret pass");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Düz metin otpauth listesi" }),
    );
    await userEvent.click(
      within(exporting).getByRole("radio", { name: /^Şifreli claviger yedeği/ }),
    );
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Farklı bir parola kullan" }),
    );
    expect(within(exporting).getByLabelText("Yedek parolası")).toHaveProperty("value", "");
  });

  it("clears the custom password after a download", async () => {
    await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Farklı bir parola kullan" }),
    );
    await userEvent.type(within(exporting).getByLabelText("Yedek parolası"), "typed secret pass");
    await userEvent.type(
      within(exporting).getByLabelText("Yedek parolasını tekrar gir"),
      "typed secret pass",
    );
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Farklı bir parola kullan" }),
    );
    expect(within(exporting).getByLabelText("Yedek parolası")).toHaveProperty("value", "");
    expect(within(exporting).getByLabelText("Yedek parolasını tekrar gir")).toHaveProperty(
      "value",
      "",
    );
  });

  it("shows no skipped warning when everything was exported", async () => {
    await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    expect(within(exporting).queryByText(/yedeğe girmedi/)).toBeNull();
    expect(within(exporting).getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("does not download when the password is wrong", async () => {
    const { ui } = await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir", "wrong password!");
    expect(await within(exporting).findByText("Parola yanlış.")).toBeTruthy();
    expect(ui.download).not.toHaveBeenCalled();
  });

  it("shows English text", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountUri", { uri: ACME });
    renderUi(
      <BackupScreen
        state={await h.ui.rpc("getState", {})}
        onChanged={() => {}}
        onImport={() => {}}
      />,
      h.ui,
      "en",
    );
    expect(screen.getByText("Download backup")).toBeTruthy();
    expect(screen.getByText("Move to browser sync")).toBeTruthy();
  });
});

describe("BackupScreen storage hardening", () => {
  it("does not move the vault when the password is wrong", async () => {
    const { ui, onChanged } = await open();
    const storage = region("Depolama");
    await userEvent.click(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
    await confirmPassword(storage, "Taşı", "wrong password!");
    expect(await within(storage).findByText("Parola yanlış.")).toBeTruthy();
    expect((await ui.rpc("getState", {})).storageArea).toBe("local");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("explains that the target storage already holds a vault", async () => {
    const h = await harness();
    for (const [key, value] of h.p.local.data)
      if (key.startsWith("vault:")) h.p.sync.data.set(key, value);
    await open(h);
    const storage = region("Depolama");
    await userEvent.click(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
    await confirmPassword(storage, "Taşı");
    expect(
      await within(storage).findByText(
        "Hedef alanda zaten bir kasa var. Önce oradaki kasayı kaldır.",
      ),
    ).toBeTruthy();
    expect((await h.ui.rpc("getState", {})).storageArea).toBe("local");
  });

  it("returns focus to the move button after cancelling", async () => {
    await open();
    const storage = region("Depolama");
    await userEvent.click(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
    await userEvent.click(within(storage).getByRole("button", { name: "Vazgeç" }));
    expect(document.activeElement).toBe(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
  });

  it("offers to move back to this device from sync", async () => {
    const h = await harness({ storageArea: "sync" });
    await open(h);
    const storage = region("Depolama");
    await userEvent.click(within(storage).getByRole("button", { name: "Yalnızca bu cihaza taşı" }));
    await confirmPassword(storage, "Taşı");
    expect(await screen.findByText("Kasa taşındı.")).toBeTruthy();
    expect((await h.ui.rpc("getState", {})).storageArea).toBe("local");
  });
});

describe("BackupScreen fix round 1", () => {
  it("warns that moving back to local removes the vault from browser sync", async () => {
    const h = await harness({ storageArea: "sync" });
    await open(h);
    const storage = region("Depolama");
    await userEvent.click(within(storage).getByRole("button", { name: "Yalnızca bu cihaza taşı" }));
    expect(
      within(storage).getByText(
        "Kasa senkronizasyondan kaldırılır; eşitlenen diğer cihazlarında artık görünmez.",
      ),
    ).toBeTruthy();
  });

  it("does not show the sync-removal warning when moving to sync", async () => {
    await open();
    const storage = region("Depolama");
    await userEvent.click(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
    expect(within(storage).queryByText(/senkronizasyondan kaldırılır/)).toBeNull();
  });

  it("never renders the plain export content", async () => {
    await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Düz metin otpauth listesi" }),
    );
    await userEvent.click(
      within(exporting).getByRole("checkbox", {
        name: "Gizli anahtarların açıkta olacağını anlıyorum",
      }),
    );
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    expect(document.body.innerHTML).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("keeps the vault local and the panel open when sync is out of quota", async () => {
    const h = await harness();
    await open(h);
    h.p.sync.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    const storage = region("Depolama");
    await userEvent.click(
      within(storage).getByRole("button", { name: "Tarayıcı senkronizasyonuna taşı" }),
    );
    await confirmPassword(storage, "Taşı");
    expect(
      await within(storage).findByText("Senkronizasyon kotası yetmiyor; kasa bu cihazda kaldı."),
    ).toBeTruthy();
    expect((await h.ui.rpc("getState", {})).storageArea).toBe("local");
    expect(within(storage).getByRole("button", { name: "Taşı" })).toBeTruthy();
  });

  it("requires the plain acknowledgement again after a download", async () => {
    await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Düz metin otpauth listesi" }),
    );
    const ack = within(exporting).getByRole("checkbox", {
      name: "Gizli anahtarların açıkta olacağını anlıyorum",
    });
    await userEvent.click(ack);
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await confirmPassword(exporting, "İndir");
    await screen.findByText("Yedek indirildi: 1 hesap.");
    expect(ack).toHaveProperty("checked", false);
    expect(within(exporting).getByRole("button", { name: "Yedeği indir" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("brings the controls back when the export stops being ready while confirming", async () => {
    await open();
    const exporting = region("Dışa aktar");
    await userEvent.click(
      within(exporting).getByRole("radio", { name: "Düz metin otpauth listesi" }),
    );
    const ack = within(exporting).getByRole("checkbox", {
      name: "Gizli anahtarların açıkta olacağını anlıyorum",
    });
    await userEvent.click(ack);
    await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
    await userEvent.click(ack);
    expect(within(exporting).queryByLabelText("Ana parola")).toBeNull();
    expect(within(exporting).getByRole("button", { name: "Yedeği indir" })).toBeTruthy();
  });

  it("hides the loss-risk sentence when there are no accounts", async () => {
    const h = await harness();
    renderUi(
      <BackupScreen
        state={await h.ui.rpc("getState", {})}
        onChanged={() => {}}
        onImport={() => {}}
      />,
      h.ui,
    );
    expect(screen.getByText("Henüz yedek alınmadı.")).toBeTruthy();
    expect(screen.queryByText(/Bu cihazı kaybedersen/)).toBeNull();
  });

  it("clears the file input after reading so the same file can be chosen again", async () => {
    const { onImport } = await open();
    const input = screen.getByLabelText("Dosya seç") as HTMLInputElement;
    const file = new File([ACME], "codes.txt");
    await userEvent.upload(input, file);
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
  });

  it("shows an alert when the file cannot be read", async () => {
    const { onImport } = await open();
    const file = new File([ACME], "codes.txt");
    Object.defineProperty(file, "arrayBuffer", { value: () => Promise.reject(new Error("boom")) });
    await userEvent.upload(screen.getByLabelText("Dosya seç"), file);
    expect(await screen.findByText("Dosya okunamadı.")).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("announces a repeated message again by clearing it first", async () => {
    const h = await harness({ storageArea: "sync" });
    await open(h);
    const exporting = region("Dışa aktar");
    const status = screen.getAllByRole("status")[0]!;
    const seen: string[] = [];
    new MutationObserver(() => seen.push(status.textContent ?? "")).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    for (let i = 0; i < 2; i++) {
      await userEvent.click(within(exporting).getByRole("button", { name: "Yedeği indir" }));
      await confirmPassword(exporting, "İndir");
      await vi.waitFor(() => expect(h.ui.download).toHaveBeenCalledTimes(i + 1));
    }
    await vi.waitFor(() =>
      expect(seen.filter((s) => s === "Yedek indirildi: 1 hesap.").length).toBe(2),
    );
    expect(seen).toContain("");
  });
});

describe("BackupScreen without a storage area", () => {
  it("drops the storage section and renumbers the automatic copies", async () => {
    await open(
      await harness({
        capabilities: {
          activeTab: true,
          qrScan: true,
          autofill: true,
          clockCheck: true,
          storageArea: false,
        },
      }),
    );
    expect(screen.queryByRole("region", { name: "Depolama" })).toBeNull();
    const copies = region("Otomatik kopyalar");
    expect(within(copies).getByText("03")).toBeTruthy();
    expect(within(copies).queryByText("04")).toBeNull();
  });
});
