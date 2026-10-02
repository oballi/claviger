import { describe, expect, it, vi } from "vitest";
import { handleUserTrigger } from "../src/background/triggers";
import type { OpenMode } from "@claviger/ui/protocol";

function setup(opts: { mode?: OpenMode; unlocked?: boolean; run?: "locked" | "done" }) {
  const calls: string[] = [];
  const service = {
    isUnlockedInMemory: () => opts.unlocked ?? false,
    flashBadge: vi.fn(async (t: string) => void calls.push(`badge:${t}`)),
  };
  const tabs = { openPopup: vi.fn(async () => (calls.push("popup"), true)) };
  const ui = {
    currentMode: () => opts.mode,
    resolveMode: vi.fn(async () => "window" as OpenMode),
    open: vi.fn((mode: OpenMode, windowId?: number) => {
      calls.push(`open:${mode}:${windowId}`);
      return Promise.resolve();
    }),
  };
  const run = vi.fn(async () => {
    calls.push("run");
    return opts.run ?? "locked";
  });
  return { calls, service, tabs, ui, run };
}

describe("locked fill in panel and window modes", () => {
  it("Firefox panel: opens synchronously, before run, when locked", () => {
    const t = setup({ mode: "panel" });
    void handleUserTrigger(t.service, t.tabs, t.run, true, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).toHaveBeenCalledWith("panel", 4);
    expect(t.tabs.openPopup).not.toHaveBeenCalled();
  });

  it("Firefox popup mode keeps using openPopup", () => {
    const t = setup({ mode: "popup" });
    void handleUserTrigger(t.service, t.tabs, t.run, true, { ui: t.ui, windowId: 4 });
    expect(t.tabs.openPopup).toHaveBeenCalled();
    expect(t.ui.open).not.toHaveBeenCalled();
  });

  it("Firefox with an unlocked vault opens nothing", async () => {
    const t = setup({ mode: "panel", unlocked: true });
    await handleUserTrigger(t.service, t.tabs, t.run, true, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).not.toHaveBeenCalled();
  });

  it("Chrome panel with a warm cache: opens the panel synchronously before any await", () => {
    const t = setup({ mode: "panel" });
    void handleUserTrigger(t.service, t.tabs, t.run, false, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).toHaveBeenCalledWith("panel", 4);
    expect(t.run).toHaveBeenCalled();
  });

  it("Chrome panel with a warm cache but an unlocked vault: nothing opens", async () => {
    const t = setup({ mode: "panel", unlocked: true, run: "done" });
    await handleUserTrigger(t.service, t.tabs, t.run, false, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).not.toHaveBeenCalled();
    expect(t.calls).toEqual(["run"]);
  });

  it("Chrome panel with an unknown mode that resolves to panel flashes ? (no gesture left)", async () => {
    const t = setup({ mode: undefined });
    t.ui.resolveMode.mockResolvedValue("panel");
    await handleUserTrigger(t.service, t.tabs, t.run, false, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).not.toHaveBeenCalled();
    expect(t.service.flashBadge).toHaveBeenCalledWith("?");
  });

  it("Chrome cold start resolving to window opens the window after run reports locked", async () => {
    const t = setup({ mode: undefined });
    await handleUserTrigger(t.service, t.tabs, t.run, false, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).toHaveBeenCalledWith("window", 4);
  });

  it("Chrome window mode opens the window only when run reports locked", async () => {
    const t = setup({ mode: "window", run: "done" });
    await handleUserTrigger(t.service, t.tabs, t.run, false, { ui: t.ui, windowId: 4 });
    expect(t.ui.open).not.toHaveBeenCalled();
    const l = setup({ mode: "window" });
    await handleUserTrigger(l.service, l.tabs, l.run, false, { ui: l.ui, windowId: 4 });
    expect(l.ui.open).toHaveBeenCalledWith("window", 4);
  });

  it("Chrome popup mode uses openPopup after a locked run", async () => {
    const t = setup({ mode: "popup" });
    await handleUserTrigger(t.service, t.tabs, t.run, false, { ui: t.ui, windowId: 4 });
    expect(t.tabs.openPopup).toHaveBeenCalled();
  });
});
