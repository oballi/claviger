import { describe, expect, it, vi } from "vitest";
import { createLauncher, type LauncherPorts } from "../src/background/launcher";
import type { OpenMode } from "@claviger/ui/protocol";

function fakePorts(opts: { chrome?: boolean; firefox?: boolean } = { chrome: true }) {
  const s = {
    popup: "popup.html",
    openOnClick: false,
    nextWindowId: 100,
    existing: new Set<number>(),
    panelWindow: undefined as number | undefined,
    target: undefined as number | undefined,
    mirror: undefined as OpenMode | undefined,
    badges: [] as string[],
    created: [] as string[],
    focused: [] as number[],
  };
  const ports: LauncherPorts = {
    setPopup: vi.fn(async (p: string) => void (s.popup = p)),
    ...(opts.chrome
      ? {
          sidePanel: {
            setOpenOnActionClick: vi.fn(async (o: boolean) => void (s.openOnClick = o)),
            open: vi.fn(async () => {}),
          },
        }
      : {}),
    ...(opts.firefox
      ? {
          sidebar: { open: vi.fn(async () => {}) },
          mirror: { get: () => s.mirror, set: (m: OpenMode) => void (s.mirror = m) },
        }
      : {}),
    windows: {
      create: vi.fn(async (url: string) => {
        s.created.push(url);
        const id = s.nextWindowId++;
        s.existing.add(id);
        return id;
      }),
      focus: vi.fn(async (id: number) => void s.focused.push(id)),
      exists: vi.fn(async (id: number) => s.existing.has(id)),
    },
    session: {
      getPanelWindow: async () => s.panelWindow,
      setPanelWindow: async (id: number | undefined) => void (s.panelWindow = id),
      setTargetWindow: async (id: number) => void (s.target = id),
    },
    flashBadge: vi.fn(async (t: string) => void s.badges.push(t)),
    panelUrl: "chrome-extension://x/sidepanel.html",
  };
  return { ports, s };
}

describe("apply", () => {
  it("popup mode restores the default popup and closes the Chrome panel-on-click behaviour", async () => {
    const { ports, s } = fakePorts();
    s.popup = "";
    s.openOnClick = true;
    await createLauncher(ports).apply("popup");
    expect(s.popup).toBe("popup.html");
    expect(s.openOnClick).toBe(false);
  });

  it("panel mode clears the popup and lets Chrome open the panel on action click", async () => {
    const { ports, s } = fakePorts();
    await createLauncher(ports).apply("panel");
    expect(s.popup).toBe("");
    expect(s.openOnClick).toBe(true);
  });

  it("window mode clears the popup and keeps the Chrome panel behaviour off", async () => {
    const { ports, s } = fakePorts();
    s.openOnClick = true;
    await createLauncher(ports).apply("window");
    expect(s.popup).toBe("");
    expect(s.openOnClick).toBe(false);
  });

  it("panel mode on Firefox clears the popup and mirrors the mode for synchronous reads", async () => {
    const { ports, s } = fakePorts({ firefox: true });
    const launcher = createLauncher(ports);
    await launcher.apply("panel");
    expect(s.popup).toBe("");
    expect(s.mirror).toBe("panel");
    expect(launcher.currentMode()).toBe("panel");
  });

  it("throws, without touching the mirror or cache, when panel is unsupported", async () => {
    const { ports, s } = fakePorts({});
    const launcher = createLauncher(ports);
    await expect(launcher.apply("panel")).rejects.toThrow("unsupported");
    expect(launcher.currentMode()).toBeUndefined();
    expect(s.popup).toBe("popup.html");
  });

  it("does not enable or disable the side panel itself (no setOptions)", async () => {
    const { ports } = fakePorts();
    expect(Object.keys(ports.sidePanel!).sort()).toEqual(["open", "setOpenOnActionClick"]);
  });

  it("fills the in-memory cache after apply", async () => {
    const { ports } = fakePorts();
    const launcher = createLauncher(ports);
    expect(launcher.currentMode()).toBeUndefined();
    await launcher.apply("window");
    expect(launcher.currentMode()).toBe("window");
  });
});

describe("action click", () => {
  it("Firefox panel: opens the sidebar synchronously, before any await", () => {
    const { ports } = fakePorts({ firefox: true });
    void createLauncher(ports).onActionClick("panel", { windowId: 3 });
    expect(ports.sidebar!.open).toHaveBeenCalledTimes(1);
  });

  it("Chrome panel: no click code (the browser opens the panel)", () => {
    const { ports } = fakePorts();
    void createLauncher(ports).onActionClick("panel", { windowId: 3 });
    expect(ports.sidePanel!.open).not.toHaveBeenCalled();
  });

  it("flashes ? when the sidebar refuses to open", async () => {
    const { ports, s } = fakePorts({ firefox: true });
    (ports.sidebar!.open as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
    await createLauncher(ports).onActionClick("panel", { windowId: 3 });
    expect(s.badges).toEqual(["?"]);
  });

  it("flashes ? when the sidebar throws synchronously", async () => {
    const { ports, s } = fakePorts({ firefox: true });
    (ports.sidebar!.open as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("no");
    });
    await createLauncher(ports).onActionClick("panel", { windowId: 3 });
    expect(s.badges).toEqual(["?"]);
  });

  it("window mode stores the clicked window and creates one panel window", async () => {
    const { ports, s } = fakePorts();
    await createLauncher(ports).onActionClick("window", { windowId: 5 });
    expect(s.target).toBe(5);
    expect(s.created).toEqual(["chrome-extension://x/sidepanel.html"]);
    expect(s.panelWindow).toBe(100);
  });

  it("window mode: the second click focuses the existing window and retargets", async () => {
    const { ports, s } = fakePorts();
    const launcher = createLauncher(ports);
    await launcher.onActionClick("window", { windowId: 5 });
    await launcher.onActionClick("window", { windowId: 6 });
    expect(s.created).toHaveLength(1);
    expect(s.focused).toEqual([100]);
    expect(s.target).toBe(6);
  });

  it("window mode: recreates the window after it was closed", async () => {
    const { ports, s } = fakePorts();
    const launcher = createLauncher(ports);
    await launcher.onActionClick("window", { windowId: 5 });
    s.existing.clear();
    await launcher.onActionClick("window", { windowId: 5 });
    expect(s.created).toHaveLength(2);
  });

  it("window mode: rapid double click opens one window", async () => {
    const { ports, s } = fakePorts();
    const launcher = createLauncher(ports);
    await Promise.all([
      launcher.onActionClick("window", { windowId: 5 }),
      launcher.onActionClick("window", { windowId: 5 }),
    ]);
    expect(s.created).toHaveLength(1);
  });

  it("window mode failure flashes ?", async () => {
    const { ports, s } = fakePorts();
    (ports.windows.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
    await createLauncher(ports).onActionClick("window", { windowId: 5 });
    expect(s.badges).toEqual(["?"]);
  });

  it("popup mode does nothing", async () => {
    const { ports, s } = fakePorts();
    await createLauncher(ports).onActionClick("popup", { windowId: 5 });
    expect(s.created).toEqual([]);
  });
});

describe("open (locked-fill triggers)", () => {
  it("Chrome panel: calls sidePanel.open with the window id synchronously", () => {
    const { ports } = fakePorts();
    void createLauncher(ports).open("panel", 9);
    expect(ports.sidePanel!.open).toHaveBeenCalledWith(9);
  });

  it("Chrome panel without a window id flashes ?", async () => {
    const { ports, s } = fakePorts();
    await createLauncher(ports).open("panel", undefined);
    expect(ports.sidePanel!.open).not.toHaveBeenCalled();
    expect(s.badges).toEqual(["?"]);
  });

  it("Firefox panel: opens the sidebar synchronously", () => {
    const { ports } = fakePorts({ firefox: true });
    void createLauncher(ports).open("panel", undefined);
    expect(ports.sidebar!.open).toHaveBeenCalledTimes(1);
  });

  it("Chrome panel failure flashes ?", async () => {
    const { ports, s } = fakePorts();
    (ports.sidePanel!.open as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
    await createLauncher(ports).open("panel", 9);
    expect(s.badges).toEqual(["?"]);
  });

  it("window mode opens or focuses the window targeting the given window", async () => {
    const { ports, s } = fakePorts();
    await createLauncher(ports).open("window", 4);
    expect(s.target).toBe(4);
    expect(s.created).toHaveLength(1);
  });
});
