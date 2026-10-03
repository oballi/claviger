// @vitest-environment jsdom
import { act, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsScreen, ManageApp } from "@claviger/ui/manage";
import { useAutoHide } from "../../../packages/ui/src/components/useAutoHide";
import { harness, renderUi, type Harness } from "./helpers/ui";
import { PASSWORD } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const QR = { name: "GitHub için QR kodu" };

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  window.location.hash = "";
});

async function seeded() {
  const h = await harness();
  await h.ui.rpc("addAccountUri", {
    uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
  });
  return h;
}

async function openEditor(h: Harness) {
  renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
  await userEvent.click(await screen.findByRole("button", { name: /GitHub.*hesabını düzenle/ }));
}

const ui = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

async function showQr(
  h: Harness,
  user: Pick<ReturnType<typeof userEvent.setup>, "click" | "type"> = userEvent as never,
) {
  await openEditor(h);
  await user.click(screen.getByRole("button", { name: "Telefona taşımak için QR göster" }));
  await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
  await user.click(screen.getByRole("button", { name: "Göster" }));
  await screen.findByRole("img", QR);
}

describe("show account as QR", () => {
  it("shows only the QR after re-auth: no plain secret, no copy button", async () => {
    const h = await seeded();
    await showQr(h);
    expect(document.body.textContent).not.toContain("JBSW Y3DP");
    expect(screen.queryByRole("button", { name: "Gizli anahtarı kopyala" })).toBeNull();
    expect(screen.getByRole("timer").textContent).toBe("60 sn içinde gizlenir");
    await userEvent.click(screen.getByRole("button", { name: "Gizle" }));
    expect(screen.queryByRole("img", QR)).toBeNull();
    expect(h.ui.copy).not.toHaveBeenCalled();
  });

  it("skips the password when the setting allows, and shows the Steam note for Steam", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountUri", {
      uri: `otpauth://steam/Steam:gaben?secret=${SECRET}&issuer=Steam`,
    });
    const { token } = await h.ui.rpc("reauth", { password: PASSWORD });
    await h.ui.rpc("setRevealRequiresPassword", { token, value: false });
    renderUi(<AccountsScreen state={await h.ui.rpc("getState", {})} onChanged={() => {}} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /Steam.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Telefona taşımak için QR göster" }));
    expect(await screen.findByRole("img", { name: "Steam için QR kodu" })).toBeTruthy();
    expect(screen.queryByLabelText("Ana parola")).toBeNull();
    expect(screen.getByText(/Steam kodları yalnızca Steam desteği olan/)).toBeTruthy();
  });

  it("asks for the password again after Hide when the setting requires it", async () => {
    const h = await seeded();
    await showQr(h);
    await userEvent.click(screen.getByRole("button", { name: "Gizle" }));
    await userEvent.click(screen.getByRole("button", { name: "Telefona taşımak için QR göster" }));
    expect(screen.queryByRole("img", QR)).toBeNull();
    expect(screen.getByLabelText("Ana parola")).toBeTruthy();
  });

  it("hides after 60 s and asks the service again next time (no cache)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = await seeded();
    const spy = vi.spyOn(h.service, "revealSecret");
    await showQr(h, ui());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(screen.queryByRole("img", QR)).toBeNull();
    expect(screen.getByRole("button", { name: "Telefona taşımak için QR göster" })).toBeTruthy();
    await ui().click(screen.getByRole("button", { name: "Telefona taşımak için QR göster" }));
    expect(screen.queryByRole("img", QR)).toBeNull();
    expect(screen.getByLabelText("Ana parola")).toBeTruthy();
  });

  it("also auto-hides the plain secret view after 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = await seeded();
    const user = ui();
    await openEditor(h);
    await user.click(screen.getByRole("button", { name: "Gizli anahtarı göster" }));
    await user.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Göster" }));
    await screen.findByText("JBSW Y3DP EHPK 3PXP");
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(screen.queryByText("JBSW Y3DP EHPK 3PXP")).toBeNull();
  });

  it("hides at once when the page becomes hidden", async () => {
    const h = await seeded();
    await showQr(h);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByRole("img", QR)).toBeNull();
  });

  it("forgets the QR when the dialog closes", async () => {
    const h = await seeded();
    await showQr(h);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    expect(screen.queryByRole("img", QR)).toBeNull();
  });

  it("removes the QR when the vault locks", async () => {
    const h = await seeded();
    renderUi(<ManageApp pollMs={20} />, h.ui);
    await userEvent.click(await screen.findByRole("button", { name: /GitHub.*hesabını düzenle/ }));
    await userEvent.click(screen.getByRole("button", { name: "Telefona taşımak için QR göster" }));
    await userEvent.type(screen.getByLabelText("Ana parola"), PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Göster" }));
    await screen.findByRole("img", QR);
    await h.service.lock();
    await vi.waitFor(() => expect(screen.queryByRole("img", QR)).toBeNull());
    expect(await screen.findByRole("heading", { name: "Kasa kilitli." })).toBeTruthy();
  });
});

describe("useAutoHide", () => {
  it("fires an inline-arrow onHide once at the deadline despite re-renders", () => {
    vi.useFakeTimers();
    const onHide = vi.fn();
    const { rerender } = renderHook(() => useAutoHide(true, 60_000, () => onHide()));
    act(() => vi.advanceTimersByTime(30_000));
    rerender();
    act(() => vi.advanceTimersByTime(29_000));
    expect(onHide).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(onHide).toHaveBeenCalled();
  });

  it("hides at once when it becomes active while the page is already hidden", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const onHide = vi.fn();
    renderHook(() => useAutoHide(true, 60_000, onHide));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
