// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanApp } from "../src/ui/scan/ScanApp";
import { AddAccount } from "../src/ui/popup/AddAccount";
import { migrationUri } from "./helpers/qr";
import { harness, renderUi, type Harness } from "./helpers/ui";

const SECRET = "JBSWY3DPEHPK3PXP";
const URI_A = `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`;
const URI_B = "otpauth://totp/Bank:you?secret=GEZDGNBVGY3TQOJQ&issuer=Bank";
const SITE = "https://github.com/settings/security";
const CAPTURE = { dataUrl: "data:image/png;base64,AAAA", tabUrl: SITE };

async function open(texts: string[][] = [[URI_A]], status: "unlocked" | "locked" = "unlocked") {
  const h = await harness({ tabUrl: SITE });
  const { id } = await h.service.storeCapture(CAPTURE);
  if (status === "locked") await h.service.lock();
  let call = 0;
  h.ui.decodeQr.mockImplementation(async () => texts[Math.min(call++, texts.length - 1)] ?? []);
  const crop = vi.fn(async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }));
  renderUi(<ScanApp captureId={id} crop={crop as never} />, h.ui);
  return { ...h, id, crop };
}

const accounts = async (h: Harness) => (await h.ui.rpc("listAccounts", {})).accounts;

afterEach(() => vi.restoreAllMocks());

describe("ScanApp", () => {
  it("adds the single QR found and links it to the captured site", async () => {
    const h = await open();
    expect(await screen.findByRole("heading", { name: "Bir QR bulundu." })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Bu siteye bağla (github.com)" })).toHaveProperty(
      "checked",
      true,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ekle" }));
    expect(await screen.findByText("Eklendi. Bu sekmeyi kapatabilirsin.")).toBeTruthy();
    expect(await accounts(h)).toMatchObject([{ issuer: "GitHub", domains: ["github.com"] }]);
    // The screenshot is dropped from the page once everything is added.
    expect(screen.queryByRole("img")).toBeNull();
    // No decoded secret stays in the rendered page.
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("otpauth");
    expect(document.body.innerHTML).not.toContain("data:image");
  });

  it("does not link the site when the box is cleared", async () => {
    const h = await open();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Bu siteye bağla/ }));
    await userEvent.click(screen.getByRole("button", { name: "Ekle" }));
    await screen.findByText(/Eklendi/);
    expect((await accounts(h))[0]?.domains).toEqual([]);
  });

  it("lists several QR codes", async () => {
    const h = await open([[URI_A, URI_B]]);
    expect(await screen.findByRole("heading", { name: "Bu görüntüde 2 QR bulundu" })).toBeTruthy();
    expect(screen.getByText("GitHub (me)")).toBeTruthy();
    expect(screen.getByText("Bank (you)")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Ekle" })[1]!);
    await vi.waitFor(async () => expect(await accounts(h)).toHaveLength(1));
    expect(screen.queryByText(/Bu sekmeyi kapatabilirsin/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ekle" }));
    expect(await screen.findByText(/Bu sekmeyi kapatabilirsin/)).toBeTruthy();
    expect(await accounts(h)).toHaveLength(2);
  });

  it("asks for a selection when nothing is found and decodes the crop", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    const h = await open([[], [URI_A]]);
    expect(await screen.findByText("QR'ın çevresine bir kutu çiz.")).toBeTruthy();
    const frame = screen.getByRole("group");
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(screen.getByTestId("scan-selection").style.left).toBe("130px");
    await userEvent.click(screen.getByRole("button", { name: "Seçili alanı tara" }));
    expect(await screen.findByRole("heading", { name: "Bir QR bulundu." })).toBeTruthy();
    expect(h.crop).toHaveBeenCalledWith(
      CAPTURE.dataUrl,
      { x: 130, y: 90, w: 160, h: 120 },
      { w: 400, h: 300 },
    );
    expect(h.ui.decodeQr).toHaveBeenCalledTimes(2);
  });

  it("sends an otpauth-migration QR through the import preview", async () => {
    const MIGRATION = migrationUri([
      ["GitHub:me", "GitHub", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
      ["Bank:you", "Bank", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]],
    ]);
    const h = await open([[MIGRATION]]);
    await userEvent.click(await screen.findByRole("button", { name: "Önizle ve içe aktar" }));
    await userEvent.click(await screen.findByRole("button", { name: "2 hesabı ekle" }));
    await userEvent.click(await screen.findByRole("button", { name: "Bitti" }));
    expect(await screen.findByText(/Bu sekmeyi kapatabilirsin/)).toBeTruthy();
    expect(await accounts(h)).toHaveLength(2);
  });

  it("draws a selection by dragging in any direction", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      toJSON: () => ({}),
    });
    await open([[], [URI_A]]);
    const frame = await screen.findByRole("group");
    fireEvent.pointerDown(frame, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    const box = screen.getByTestId("scan-selection").style;
    expect([box.left, box.top, box.width, box.height]).toEqual(["100px", "50px", "100px", "100px"]);
    // A click without a drag falls back to the centred box.
    fireEvent.pointerDown(frame, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(frame, { pointerId: 1 });
    expect(screen.getByTestId("scan-selection").style.left).toBe("120px");
  });

  it("scans the whole image again from the keyboard fallback button", async () => {
    const h = await open([[], [URI_A]]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Bütün görüntüyü tekrar tara" }),
    );
    expect(await screen.findByRole("heading", { name: "Bir QR bulundu." })).toBeTruthy();
    expect(h.ui.decodeQr).toHaveBeenCalledTimes(2);
  });

  it("says so when the selection holds no QR code", async () => {
    await open([[], []]);
    await userEvent.click(await screen.findByRole("button", { name: "Seçili alanı tara" }));
    expect(await screen.findByText("Bu alanda QR bulunamadı.")).toBeTruthy();
  });

  it("explains a QR that is not a 2FA code", async () => {
    await open([["https://example.com"]]);
    expect(await screen.findByText("QR bulundu ama 2FA kodu değil.")).toBeTruthy();
  });

  it("shows the expired message", async () => {
    const h = await open();
    await screen.findByRole("heading", { name: "Bir QR bulundu." });
    const again = renderUi(<ScanApp captureId="gone" />, h.ui);
    expect(await again.findByText(/Görüntünün süresi doldu/)).toBeTruthy();
  });

  it("shows the locked message instead of a password prompt when the vault is locked", async () => {
    await open([[URI_A]], "locked");
    expect(await screen.findByText("Kasa kilitlendi; taramayı tekrar başlat.")).toBeTruthy();
    expect(screen.queryByLabelText("Ana parola")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("clears the screenshot and results when the vault locks while the page is open", async () => {
    const h = await open([[URI_A, URI_B]]);
    await screen.findByRole("heading", { name: "Bu görüntüde 2 QR bulundu" });
    expect(screen.getByRole("img")).toBeTruthy();
    await h.service.lock();
    expect(await screen.findByText(/Kasa kilitlendi/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("GitHub (me)")).toBeNull();
  });

  it("clears everything five minutes after the page loaded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await open([[URI_A]]);
      await screen.findByRole("heading", { name: "Bir QR bulundu." });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
      });
      expect(screen.getByText(/süresi doldu/)).toBeTruthy();
      expect(screen.queryByRole("img")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AddAccount screen scan", () => {
  async function popup() {
    const h = await harness({ tabUrl: SITE });
    renderUi(
      <AddAccount tabUrl={SITE} tabDomain="github.com" onBack={vi.fn()} onAdded={vi.fn()} />,
      h.ui,
    );
    return h;
  }

  it("shows the restricted page message when capture fails", async () => {
    const h = await popup();
    h.ui.captureTab.mockResolvedValue(null);
    await userEvent.click(screen.getByRole("button", { name: /Ekrandan QR tara/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Bu sayfada tarama yapılamaz");
    expect(h.ui.openScan).not.toHaveBeenCalled();
  });

  it("stores the capture before opening the scan page", async () => {
    const h = await popup();
    h.ui.captureTab.mockResolvedValue(CAPTURE);
    await userEvent.click(screen.getByRole("button", { name: /Ekrandan QR tara/ }));
    await vi.waitFor(() => expect(h.ui.openScan).toHaveBeenCalledTimes(1));
    const id = h.ui.openScan.mock.calls[0]![0];
    expect(await h.service.takeCapture(id)).toEqual(CAPTURE);
  });
});
