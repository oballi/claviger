// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodesScreen } from "@claviger/ui/popup";
import { harness, renderUi } from "./helpers/ui";

const mocks = vi.hoisted(() => {
  const event = <A extends unknown[] = []>() => {
    const listeners = new Set<(...args: A) => void>();
    return {
      listeners,
      addListener: (l: (...args: A) => void) => listeners.add(l),
      removeListener: (l: (...args: A) => void) => listeners.delete(l),
      fire: (...args: A) => listeners.forEach((l) => l(...args)),
    };
  };
  return {
    state: {
      windowType: "normal" as string,
      windowId: 7,
      session: {} as Record<string, unknown>,
      tabs: [] as { id: number; url?: string; windowId: number; active: boolean }[],
    },
    onActivated: event(),
    onUpdated: event(),
    onRemoved: event(),
    onStorageChanged: event<[Record<string, unknown>, string]>(),
    query: vi.fn(),
    create: vi.fn(async () => ({})),
    capture: vi.fn(async () => "data:image/png;base64,AAAA"),
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      getURL: (path: string) => `chrome-extension://ext-id${path}`,
      getContexts: async () => [],
    },
    windows: {
      getCurrent: async () => ({ type: mocks.state.windowType, id: mocks.state.windowId }),
      onRemoved: mocks.onRemoved,
      update: vi.fn(),
    },
    storage: {
      session: { get: async (key: string) => ({ [key]: mocks.state.session[key] }) },
      onChanged: mocks.onStorageChanged,
    },
    tabs: {
      query: mocks.query,
      create: mocks.create,
      update: vi.fn(),
      captureVisibleTab: mocks.capture,
      onActivated: mocks.onActivated,
      onUpdated: mocks.onUpdated,
    },
    permissions: {},
  },
}));

import { createBrowserUiPlatform } from "../src/platform/uiPlatform";

const closeSpy = vi.fn();
beforeEach(() => {
  mocks.state.windowType = "normal";
  mocks.state.windowId = 7;
  mocks.state.session = {};
  mocks.state.tabs = [{ id: 1, url: "https://example.com/login", windowId: 7, active: true }];
  mocks.query.mockImplementation(
    async (q: { active?: boolean; windowId?: number; currentWindow?: boolean }) =>
      mocks.state.tabs.filter(
        (t) =>
          t.active &&
          (q.windowId === undefined || t.windowId === q.windowId) &&
          (!q.currentWindow || t.windowId === mocks.state.windowId),
      ),
  );
  mocks.create.mockClear();
  mocks.capture.mockClear();
  closeSpy.mockClear();
  vi.stubGlobal("close", closeSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.onActivated.listeners.clear();
  mocks.onUpdated.listeners.clear();
  mocks.onRemoved.listeners.clear();
});

describe("panel context", () => {
  it("resolves the tab of the window the side panel lives in", async () => {
    const ui = createBrowserUiPlatform("panel");
    expect(await ui.activeTab()).toEqual({ id: 1, url: "https://example.com/login" });
    expect(mocks.query).toHaveBeenCalledWith({ active: true, windowId: 7 });
  });

  it("window mode follows the stored target window, not its own", async () => {
    mocks.state.windowType = "popup";
    mocks.state.windowId = 99;
    mocks.state.session = { "claviger-target-window": 7 };
    const ui = createBrowserUiPlatform("panel");
    expect(await ui.activeTab()).toEqual({ id: 1, url: "https://example.com/login" });
    expect(mocks.query).toHaveBeenCalledWith({ active: true, windowId: 7 });
  });

  it("has no tab when window mode has no stored target or the tab has no URL", async () => {
    mocks.state.windowType = "popup";
    const ui = createBrowserUiPlatform("panel");
    expect(await ui.activeTab()).toBeUndefined();
    expect(await ui.captureTab()).toBeNull();
    mocks.state.session = { "claviger-target-window": 7 };
    mocks.state.tabs = [{ id: 2, windowId: 7, active: true }];
    expect(await ui.activeTab()).toBeUndefined();
  });

  it("captures the target window with its id", async () => {
    mocks.state.windowType = "popup";
    mocks.state.windowId = 99;
    mocks.state.session = { "claviger-target-window": 7 };
    const ui = createBrowserUiPlatform("panel");
    expect(await ui.captureTab()).toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      tabUrl: "https://example.com/login",
    });
    expect(mocks.capture).toHaveBeenCalledWith(7, { format: "png" });
  });

  it("drops the capture when the tab navigated meanwhile", async () => {
    const ui = createBrowserUiPlatform("panel");
    mocks.capture.mockImplementationOnce(async () => {
      mocks.state.tabs = [{ id: 1, url: "https://evil.test/", windowId: 7, active: true }];
      return "data:image/png;base64,AAAA";
    });
    expect(await ui.captureTab()).toBeNull();
  });

  it("popup context keeps using the current window", async () => {
    const ui = createBrowserUiPlatform("popup");
    await ui.activeTab();
    expect(mocks.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    await ui.captureTab();
    expect(mocks.capture).toHaveBeenCalledWith({ format: "png" });
  });

  it("subscribes to tab changes in panel context only and unsubscribes", () => {
    expect(createBrowserUiPlatform("popup").onActiveTabChange).toBeUndefined();
    const ui = createBrowserUiPlatform("panel");
    const listener = vi.fn();
    const off = ui.onActiveTabChange!(listener);
    mocks.onActivated.fire();
    mocks.onUpdated.fire();
    mocks.onRemoved.fire();
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    mocks.onActivated.fire();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("drops 'this site' after the active tab becomes a URL-less tab", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountUri", {
      uri: "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
      sourceUrl: "https://github.com",
    });
    mocks.state.tabs = [{ id: 1, url: "https://github.com/login", windowId: 7, active: true }];
    const platform = createBrowserUiPlatform("panel");
    const ui = {
      ...h.ui,
      activeTab: platform.activeTab,
      onActiveTabChange: platform.onActiveTabChange,
    };
    const state = await h.service.getState();
    renderUi(<CodesScreen state={state} pollMs={0} onLocked={() => {}} />, ui);
    expect(await screen.findByText("Bu site")).toBeTruthy();
    mocks.state.tabs = [{ id: 2, windowId: 7, active: true }];
    mocks.onActivated.fire();
    await waitFor(() => expect(screen.queryByText("Bu site")).toBeNull());
  });

  it("clears 'this site' synchronously on a tab change, before the new tab is resolved", async () => {
    const h = await harness();
    await h.ui.rpc("addAccountUri", {
      uri: "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
      sourceUrl: "https://github.com",
    });
    let release: (tab: { id: number; url: string }) => void = () => {};
    let first = true;
    const ui = {
      ...h.ui,
      activeTab: () =>
        first
          ? ((first = false), Promise.resolve({ id: 1, url: "https://github.com/login" }))
          : new Promise<{ id: number; url: string }>((resolve) => (release = resolve)),
      onActiveTabChange: createBrowserUiPlatform("panel").onActiveTabChange,
    };
    renderUi(<CodesScreen state={await h.service.getState()} pollMs={0} onLocked={() => {}} />, ui);
    expect(await screen.findByText("Bu site")).toBeTruthy();
    mocks.onActivated.fire();
    // The new tab is still unresolved here: the old site's match must already be gone.
    await waitFor(() => expect(screen.queryByText("Bu site")).toBeNull());
    release({ id: 2, url: "https://github.com/other" });
    expect(await screen.findByText("Bu site")).toBeTruthy();
  });

  it("re-resolves when the launcher retargets the window (session key change)", async () => {
    const platform = createBrowserUiPlatform("panel");
    const listener = vi.fn();
    platform.onActiveTabChange!(listener);
    mocks.onStorageChanged.fire({ "claviger-target-window": { newValue: 9 } }, "session");
    expect(listener).toHaveBeenCalledTimes(1);
    mocks.onStorageChanged.fire({ settings: {} }, "local");
    mocks.onStorageChanged.fire({ other: {} }, "session");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("opening other pages", () => {
  it("openManage in panel context does not close the page and stays in the target window", async () => {
    mocks.state.windowType = "popup";
    mocks.state.session = { "claviger-target-window": 7 };
    createBrowserUiPlatform("panel").openManage("security");
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledWith({
      url: "chrome-extension://ext-id/manage.html#/security",
      windowId: 7,
    });
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("openScan in panel context does not close the page and passes the target window", async () => {
    mocks.state.windowType = "popup";
    mocks.state.session = { "claviger-target-window": 7 };
    createBrowserUiPlatform("panel").openScan("abc");
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledWith({
      url: "chrome-extension://ext-id/scan.html#abc",
      windowId: 7,
    });
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("the popup still closes itself after opening a tab", async () => {
    createBrowserUiPlatform("popup").openScan("abc");
    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
    expect(mocks.create).toHaveBeenCalledWith({ url: "chrome-extension://ext-id/scan.html#abc" });
  });
});
