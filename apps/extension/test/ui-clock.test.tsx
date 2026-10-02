// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PopupApp } from "@otp-vault/ui/popup";
import { SecurityScreen } from "../src/ui/manage/SecurityScreen";
import { harness, renderUi, type Harness } from "./helpers/ui";

async function open(h: Harness) {
  renderUi(<SecurityScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
}

const sampleAt = (h: Harness, skewSec: number) => {
  const now = h.p.clock.now();
  return { serverDate: new Date(now + skewSec * 1000).toUTCString(), startMs: now, endMs: now };
};

describe("clock check", () => {
  it("does nothing when permission is denied", async () => {
    const h = await harness();
    h.ui.requestClockPermission.mockResolvedValue(false);
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText("İzin verilmedi; kontrol yapılmadı.")).toBeTruthy();
    expect(h.ui.fetchServerDate).not.toHaveBeenCalled();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: false,
      clockOffsetSec: 0,
    });
  });

  it("applies a large offset and shows it", async () => {
    const h = await harness();
    h.ui.fetchServerDate.mockImplementation(async () => sampleAt(h, 120));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(
      await screen.findByText("Saatin 120 sn farklı; kodlar buna göre düzeltildi."),
    ).toBeTruthy();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: true,
      clockOffsetSec: 120,
    });
    expect(h.ui.removeClockPermission).toHaveBeenCalled();
  });

  it("reports a correct clock without applying", async () => {
    const h = await harness();
    h.ui.fetchServerDate.mockImplementation(async () => sampleAt(h, 5));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText("Saatin doğru (fark 5 sn). Kontrol kapatıldı.")).toBeTruthy();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: false,
      clockOffsetSec: 0,
    });
    expect(h.ui.removeClockPermission).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Düzeltmeyi kaldır" })).toBeNull();
  });

  it("refuses a sample whose end is before its start", async () => {
    const h = await harness();
    h.ui.fetchServerDate.mockImplementation(async () => ({
      ...sampleAt(h, 120),
      startMs: 2000,
      endMs: 1000,
    }));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText(/Saat ölçüm sırasında değişti; tekrar dene\./)).toBeTruthy();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: false,
      clockOffsetSec: 0,
    });
    expect(h.ui.removeClockPermission).toHaveBeenCalled();
  });

  it("keeps the check enabled without an offset when the fetch fails", async () => {
    const h = await harness();
    h.ui.fetchServerDate.mockRejectedValue(new Error("offline"));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText(/Google'a ulaşılamadı/)).toBeTruthy();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: false,
      clockOffsetSec: 0,
    });
    expect(h.ui.removeClockPermission).toHaveBeenCalled();
  });

  it("a failed re-check keeps the existing correction", async () => {
    const h = await harness();
    await h.ui.rpc("setClockCheckEnabled", { enabled: true });
    await h.ui.rpc("applyClockSample", sampleAt(h, 120));
    h.ui.fetchServerDate.mockRejectedValue(new Error("offline"));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText(/Google'a ulaşılamadı/)).toBeTruthy();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: true,
      clockOffsetSec: 120,
    });
    expect(h.ui.removeClockPermission).toHaveBeenCalled();
  });

  it("refuses a sample that took too long and turns the check off", async () => {
    const h = await harness();
    h.ui.fetchServerDate.mockImplementation(async () => ({
      ...sampleAt(h, 120),
      endMs: h.p.clock.now() + 10_001,
    }));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText(/Google'a ulaşılamadı/)).toBeTruthy();
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: false,
      clockOffsetSec: 0,
    });
  });

  it("notes when the permission cannot be removed", async () => {
    const h = await harness();
    h.ui.removeClockPermission.mockRejectedValue(new Error("nope"));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Kontrol et" }));
    expect(await screen.findByText(/İzin kaldırılamadı/)).toBeTruthy();
  });

  it("shows the remove button whenever the check is enabled", async () => {
    const h = await harness();
    await h.ui.rpc("setClockCheckEnabled", { enabled: true });
    await open(h);
    expect(screen.getByRole("button", { name: "Düzeltmeyi kaldır" })).toBeTruthy();
  });

  it("removing the correction disables the check and resets the offset", async () => {
    const h = await harness();
    await h.ui.rpc("setClockCheckEnabled", { enabled: true });
    await h.ui.rpc("applyClockSample", sampleAt(h, 120));
    await open(h);
    await userEvent.click(screen.getByRole("button", { name: "Düzeltmeyi kaldır" }));
    await waitFor(() => expect(h.ui.removeClockPermission).toHaveBeenCalled());
    expect(await h.ui.rpc("getState", {})).toMatchObject({
      clockCheckEnabled: false,
      clockOffsetSec: 0,
    });
    expect(h.ui.removeClockPermission).toHaveBeenCalled();
  });

  it("popup shows the active correction", async () => {
    const h = await harness();
    await h.ui.rpc("setClockCheckEnabled", { enabled: true });
    await h.ui.rpc("applyClockSample", sampleAt(h, 120));
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await userEvent.click(await screen.findByText("Saat farkı düzeltiliyor (120 sn)"));
    expect(h.ui.openManage).toHaveBeenCalledWith("security");
  });
});
