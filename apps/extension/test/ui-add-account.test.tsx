// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RpcError } from "@claviger/ui/rpc-client";
import { AddAccount } from "@claviger/ui/popup";
import { QrImageTooLargeError } from "@claviger/ui/qr-limits";
import { harness, renderUi } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";

async function open(tabUrl?: string, capabilities?: { qrScan: boolean }) {
  const h = await harness({ tabUrl, capabilities });
  const onBack = vi.fn();
  const onAdded = vi.fn();
  renderUi(
    <AddAccount
      tabUrl={tabUrl}
      tabDomain={tabUrl ? (await h.ui.rpc("listAccounts", { pageUrl: tabUrl })).pageDomain : null}
      onBack={onBack}
      onAdded={onAdded}
    />,
    h.ui,
  );
  return { ...h, onBack, onAdded };
}

const accounts = async (h: Awaited<ReturnType<typeof open>>) =>
  (await h.ui.rpc("listAccounts", {})).accounts;

describe("AddAccount", () => {
  it("lists the sources", async () => {
    const h = await open();
    expect(screen.getByRole("heading", { name: "Hesap ekle." })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ekrandan QR tara/ })).toHaveProperty(
      "disabled",
      false,
    );
    await userEvent.click(screen.getByRole("button", { name: /İçe aktar/ }));
    expect(h.ui.openManage).toHaveBeenCalledWith("backup");
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(h.onBack).toHaveBeenCalled();
  });

  it("makes QR scanning the primary action with the paste hint right under it", async () => {
    await open();
    const qr = screen.getByRole("button", { name: /Ekrandan QR tara/ });
    expect(qr.className).toContain("bg-btn");
    expect(screen.getByRole("button", { name: /Elle gir/ }).className).not.toContain("bg-btn");
    const hint = screen.getByText("Veya bir QR görselini buraya yapıştır (Ctrl+V).");
    expect(qr.parentElement).toBe(hint.parentElement);
  });

  it("adds from a pasted link and binds the current site when the box stays ticked", async () => {
    const h = await open("https://github.com/settings/security");
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    expect(screen.getByRole("checkbox", { name: "Bu siteye bağla (github.com)" })).toHaveProperty(
      "checked",
      true,
    );
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("GitHub"));
    expect(await accounts(h)).toMatchObject([{ issuer: "GitHub", domains: ["github.com"] }]);
  });

  it("does not bind the site when the box is cleared", async () => {
    const h = await open("https://mail.google.com/");
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Bu siteye bağla (google.com)" }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.type(screen.getByLabelText("Servis"), "Bank");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("Bank"));
    expect(await accounts(h)).toMatchObject([{ issuer: "Bank", domains: [] }]);
  });

  it("offers no binding without a web page and supports advanced options", async () => {
    const h = await open("chrome://extensions");
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      "jbsw y3dp ehpk 3pxp",
    );
    await userEvent.type(screen.getByLabelText("Hesap"), "ali");
    await userEvent.click(screen.getByText("Gelişmiş"));
    await userEvent.selectOptions(screen.getByLabelText("Tür"), "hotp");
    await userEvent.selectOptions(screen.getByLabelText("Algoritma"), "SHA256");
    await userEvent.selectOptions(screen.getByLabelText("Hane"), "8");
    await userEvent.clear(screen.getByLabelText("Süre (sn)"));
    await userEvent.type(screen.getByLabelText("Süre (sn)"), "60");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("ali"));
    expect(await accounts(h)).toMatchObject([
      { label: "ali", type: "hotp", algorithm: "SHA256", digits: 8 },
    ]);
  });

  it("explains invalid keys and duplicates, and goes back to the menu", async () => {
    const h = await open();
    await h.ui.rpc("addAccountUri", { uri: `otpauth://totp/x?secret=${SECRET}` });
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    const field = screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı");
    await userEvent.type(field, "not base32!");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Kurulum anahtarı geçersiz. Yalnızca A–Z ve 2–7 karakterleri olabilir.",
      ),
    );
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe("add-secret-error");
    expect(document.activeElement).toBe(field);
    await userEvent.clear(field);
    await userEvent.type(field, SECRET);
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Bu hesap zaten kayıtlı."),
    );
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(screen.getByRole("heading", { name: "Hesap ekle." })).toBeTruthy();
    expect(h.onBack).not.toHaveBeenCalled();
  });

  async function fillSameName(h: Awaited<ReturnType<typeof open>>) {
    await h.ui.rpc("addAccountManual", { draft: { secret: SECRET, issuer: "Bank", label: "me" } });
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      "GEZDGNBVGY3TQOJQ",
    );
    await userEvent.type(screen.getByLabelText("Servis"), "Bank");
    await userEvent.type(screen.getByLabelText("Hesap"), "me");
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
  }

  it("asks before saving a second account with the same name", async () => {
    const h = await open();
    await fillSameName(h);
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Bu adla başka bir hesap"),
    );
    expect(h.onAdded).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yine de kaydet" }));
    await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("Bank"));
    expect(await accounts(h)).toHaveLength(2);
  });

  it("resets the same-name warning when a field changes", async () => {
    const h = await open();
    await fillSameName(h);
    await screen.findByRole("button", { name: "Yine de kaydet" });
    await userEvent.type(screen.getByLabelText("Hesap"), "2");
    expect(screen.queryByRole("button", { name: "Yine de kaydet" })).toBeNull();
    expect(screen.getByRole("button", { name: "Hesabı ekle" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects out-of-range digits locally and opens Advanced", async () => {
    const h = await open();
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.click(screen.getByRole("button", { name: "Gelişmiş" }));
    const digits = screen.getByLabelText("Hane");
    fireEvent.change(digits, { target: { value: "9" } });
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Hane veya süre değeri geçersiz."),
    );
    expect(screen.getByRole("button", { name: "Gelişmiş" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(digits.getAttribute("aria-invalid")).toBe("true");
    expect(digits.getAttribute("aria-describedby")).toBe("add-digits-error");
    await vi.waitFor(() => expect(document.activeElement).toBe(digits));
    expect(await accounts(h)).toHaveLength(0);
  });

  it("rejects an out-of-range period locally", async () => {
    const h = await open();
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.click(screen.getByRole("button", { name: "Gelişmiş" }));
    const period = screen.getByLabelText("Süre (sn)");
    fireEvent.change(period, { target: { value: "301" } });
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await screen.findByText("Hane veya süre değeri geçersiz.");
    expect(period.getAttribute("aria-invalid")).toBe("true");
    await vi.waitFor(() => expect(document.activeElement).toBe(period));
    expect(await accounts(h)).toHaveLength(0);
  });

  it("keeps Advanced collapsed by default and toggles it", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    const toggle = screen.getByRole("button", { name: "Gelişmiş" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Hane")).toBeNull();
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Hane")).toBeTruthy();
  });

  it("puts a rejected algorithm under its own field", async () => {
    const h = await harness();
    const rpc: typeof h.ui.rpc = async (t, payload) => {
      if (t === "addAccountManual") throw new RpcError("unsupported-algorithm", "x");
      return h.ui.rpc(t, payload);
    };
    renderUi(<AddAccount onBack={vi.fn()} onAdded={vi.fn()} />, { ...h.ui, rpc });
    await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
    await userEvent.type(
      screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı"),
      SECRET,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
    await screen.findByText("Bu algoritma desteklenmiyor.");
    const algorithm = screen.getByLabelText("Algoritma");
    expect(algorithm.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Tür").getAttribute("aria-invalid")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(algorithm));
  });

  describe("otpauth paste", () => {
    const URI = `otpauth://totp/Acme:me@x.io?secret=${SECRET}&issuer=Acme&algorithm=SHA256&digits=8&period=60`;

    it("fills every field and opens Advanced for non-default values", async () => {
      const h = await open();
      await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
      const field = screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı");
      await userEvent.click(field);
      await userEvent.paste(URI);
      expect((field as HTMLInputElement).value).toBe(SECRET);
      expect((screen.getByLabelText("Servis") as HTMLInputElement).value).toBe("Acme");
      expect((screen.getByLabelText("Hesap") as HTMLInputElement).value).toBe("me@x.io");
      expect(screen.getByRole("button", { name: "Gelişmiş" }).getAttribute("aria-expanded")).toBe(
        "true",
      );
      expect((screen.getByLabelText("Algoritma") as HTMLSelectElement).value).toBe("SHA256");
      expect((screen.getByLabelText("Hane") as HTMLSelectElement).value).toBe("8");
      expect((screen.getByLabelText("Süre (sn)") as HTMLInputElement).value).toBe("60");
      await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
      await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalledWith("Acme"));
      expect(await accounts(h)).toMatchObject([
        { issuer: "Acme", label: "me@x.io", algorithm: "SHA256", digits: 8, period: 60 },
      ]);
    });

    it("keeps Advanced closed for defaults and the pasted text for an invalid link", async () => {
      await open();
      await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
      const field = screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı");
      await userEvent.click(field);
      await userEvent.paste("otpauth://totp/x");
      expect((field as HTMLInputElement).value).toBe("otpauth://totp/x");
      await userEvent.clear(field);
      await userEvent.paste(`otpauth://totp/Acme:me?secret=${SECRET}`);
      expect((field as HTMLInputElement).value).toBe(SECRET);
      expect(screen.getByRole("button", { name: "Gelişmiş" }).getAttribute("aria-expanded")).toBe(
        "false",
      );
    });

    const pasteInto = async (uri: string) => {
      const h = await open();
      await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
      const field = screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı");
      await userEvent.click(field);
      await userEvent.paste(uri);
      return { h, field: field as HTMLInputElement };
    };
    const base = `otpauth://totp/Acme:me?secret=${SECRET}`;

    it.each(["SHA-256", "SHA256", "sha-256"])("normalizes algorithm %s like core", async (alg) => {
      const { h, field } = await pasteInto(`${base}&algorithm=${alg}`);
      expect(field.value).toBe(SECRET);
      expect((screen.getByLabelText("Algoritma") as HTMLSelectElement).value).toBe("SHA256");
      await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
      await vi.waitFor(() => expect(h.onAdded).toHaveBeenCalled());
      expect(await accounts(h)).toMatchObject([{ algorithm: "SHA256" }]);
    });

    it("fills SHA512", async () => {
      const { field } = await pasteInto(`${base}&algorithm=SHA512`);
      expect(field.value).toBe(SECRET);
      expect((screen.getByLabelText("Algoritma") as HTMLSelectElement).value).toBe("SHA512");
    });

    it("keeps an unsupported algorithm link as typed so submit reports it", async () => {
      const { h, field } = await pasteInto(`${base}&algorithm=MD5`);
      expect(field.value).toBe(`${base}&algorithm=MD5`);
      await userEvent.click(screen.getByRole("button", { name: "Hesabı ekle" }));
      expect(await screen.findByText("Bu algoritma desteklenmiyor.")).toBeTruthy();
      expect(h.onAdded).not.toHaveBeenCalled();
    });

    it.each([
      ["digits=9", "digits=9"],
      ["digits=10", "digits=10"],
      ["period=0", "period=0"],
      ["counter=-1 (hotp)", "counter=-1"],
    ])("keeps a link with %s as typed", async (_name, param) => {
      const uri =
        (param.startsWith("counter") ? base.replace("/totp/", "/hotp/") : base) + `&${param}`;
      const { field } = await pasteInto(uri);
      expect(field.value).toBe(uri);
    });

    it("also parses a link pasted into the service field", async () => {
      await open();
      await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
      await userEvent.click(screen.getByLabelText("Servis"));
      await userEvent.paste(URI);
      expect(
        (screen.getByLabelText("Kurulum anahtarı veya otpauth:// bağlantısı") as HTMLInputElement)
          .value,
      ).toBe(SECRET);
    });
  });

  describe("pasted QR image", () => {
    const png = () => new File(["x"], "qr.png", { type: "image/png" });
    const paste = (files: File[]) =>
      fireEvent.paste(document.body, { clipboardData: { files, types: ["Files"] } });

    it("stores the capture without a site and opens the scan page", async () => {
      const h = await open("https://github.com/");
      paste([png()]);
      await vi.waitFor(() => expect(h.ui.openScan).toHaveBeenCalledTimes(1));
      expect(h.ui.imageToCapture).toHaveBeenCalledTimes(1);
      const id = h.ui.openScan.mock.calls[0]![0];
      expect(await h.ui.rpc("takeCapture", { id })).toEqual({
        dataUrl: "data:image/png;base64,AAAA",
        tabUrl: "",
      });
      expect(screen.getByText("Veya bir QR görselini buraya yapıştır (Ctrl+V).")).toBeTruthy();
    });

    it("warns when the image is too large and stores nothing", async () => {
      const h = await open();
      h.ui.imageToCapture.mockRejectedValue(new QrImageTooLargeError());
      paste([png()]);
      expect(await screen.findByText("Görsel çok büyük.")).toBeTruthy();
      expect(h.ui.openScan).not.toHaveBeenCalled();
    });

    it("ignores non-image pastes and the manual form", async () => {
      const h = await open();
      paste([new File(["x"], "a.txt", { type: "text/plain" })]);
      await userEvent.click(screen.getByRole("button", { name: /Elle gir/ }));
      paste([png()]);
      expect(h.ui.imageToCapture).not.toHaveBeenCalled();
    });

    it("installs no listener and no hint without QR scanning", async () => {
      const h = await open(undefined, { qrScan: false });
      paste([png()]);
      expect(h.ui.imageToCapture).not.toHaveBeenCalled();
      expect(screen.queryByText(/Ctrl\+V/)).toBeNull();
    });
  });
});
