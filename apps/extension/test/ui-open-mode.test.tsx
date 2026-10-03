// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesScreen } from "@claviger/ui/manage";
import { PopupApp, POPUP_DIMENSIONS, readCachedPopupSize } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const radio = (group: string, name: string) =>
  within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });

async function security() {
  const h = await harness();
  const state = await h.service.getState();
  const view = renderUi(<PreferencesScreen state={state} onChanged={() => {}} />, h.ui);
  return { h, ...view };
}

describe("popup layout", () => {
  it("sizes the popup root per setting and fills the panel", async () => {
    const h = await harness();
    const root = async (props: { size?: "small" | "large"; layout?: "panel" }) => {
      const view = renderUi(<PopupApp pollMs={0} {...props} />, h.ui);
      await screen.findByText("Henüz hesap yok.");
      const cls = view.container.firstElementChild!.className;
      view.unmount();
      return cls;
    };
    expect(await root({ size: "small" })).toContain("w-[320px]");
    expect(await root({ size: "small" })).toContain("h-[460px]");
    expect(await root({ size: "large" })).toContain("w-[420px]");
    const panel = await root({ layout: "panel" });
    expect(panel).toContain("h-screen");
    expect(panel).not.toContain("w-[360px]");
  });

  it("defaults to the medium popup size", async () => {
    const h = await harness();
    const { container } = renderUi(<PopupApp pollMs={0} />, h.ui);
    await screen.findByText("Henüz hesap yok.");
    expect(container.firstElementChild!.className).toContain("w-[360px]");
  });

  it("mirrors the stored size for the next open and ignores a bad cache", async () => {
    const h = await harness();
    await h.ui.rpc("setPopupSize", { size: "large" });
    renderUi(<PopupApp pollMs={0} />, h.ui);
    await waitFor(() => expect(readCachedPopupSize()).toBe("large"));
    localStorage.setItem("claviger-popup-size", "huge");
    expect(readCachedPopupSize()).toBe("medium");
    expect(POPUP_DIMENSIONS.medium).toEqual([360, 540]);
  });
});

describe("open mode settings", () => {
  it("saves the open mode through the RPC and disables the size row outside popup mode", async () => {
    const { h } = await security();
    const size = screen.getByRole("radiogroup", { name: "Popup boyutu" });
    expect(within(size).getByRole("radio", { name: "Küçük" })).toHaveProperty("disabled", false);
    await userEvent.click(radio("Açılış biçimi", "Yan panel"));
    await waitFor(async () => expect((await h.service.getState()).openMode).toBe("panel"));
  });

  it("disables the size row when the mode is not popup", async () => {
    const h = await harness();
    await h.ui.rpc("setOpenMode", { mode: "window" });
    renderUi(<PreferencesScreen state={await h.service.getState()} onChanged={() => {}} />, h.ui);
    expect(radio("Popup boyutu", "Küçük")).toHaveProperty("disabled", true);
  });

  it("saves the popup size", async () => {
    const { h } = await security();
    await userEvent.click(radio("Popup boyutu", "Küçük"));
    await waitFor(async () => expect((await h.service.getState()).popupSize).toBe("small"));
  });

  it("shows the error and keeps the old mode when the browser refuses it", async () => {
    const h = await harness();
    const refusing = h.service as unknown as { onOpenModeChange: () => Promise<void> };
    refusing.onOpenModeChange = async () => {
      throw new Error("no side panel");
    };
    renderUi(<PreferencesScreen state={await h.service.getState()} onChanged={() => {}} />, h.ui);
    await userEvent.click(radio("Açılış biçimi", "Yan panel"));
    expect(await screen.findByText("Bu tarayıcı bu açılış biçimini desteklemiyor.")).toBeTruthy();
    expect((await h.service.getState()).openMode).toBe("popup");
  });
});
