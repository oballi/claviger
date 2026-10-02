import type { OpenMode } from "@claviger/ui/protocol";

const WINDOW_WIDTH = 400;
const WINDOW_HEIGHT = 640;

export interface LauncherPorts {
  /** action.setPopup; "" makes the toolbar click fire action.onClicked. */
  setPopup(path: string): Promise<void>;
  /** Chrome only. Panel mode relies on openPanelOnActionClick, so there is no click code. */
  sidePanel?: {
    setOpenOnActionClick(open: boolean): Promise<void>;
    open(windowId: number): Promise<void>;
  };
  /** Firefox only. */
  sidebar?: { open(): Promise<void> };
  windows: {
    create(url: string, width: number, height: number): Promise<number>;
    focus(id: number): Promise<void>;
    exists(id: number): Promise<boolean>;
  };
  /** Window ids only, never secrets. */
  session: {
    getPanelWindow(): Promise<number | undefined>;
    setPanelWindow(id: number | undefined): Promise<void>;
    /** The browsing window the panel page acts on. */
    setTargetWindow(id: number): Promise<void>;
  };
  /** Synchronous copy of the mode (Firefox background-page localStorage); user-action APIs cannot wait for storage. */
  mirror?: { get(): OpenMode | undefined; set(mode: OpenMode): void };
  flashBadge(text: string): Promise<void>;
  panelUrl: string;
}

export function createLauncher(ports: LauncherPorts) {
  // Filled by apply(); lets Chrome read the mode synchronously inside a user-action handler.
  let cached: OpenMode | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const flash = () => void ports.flashBadge("?").catch(() => undefined);

  // The sidebar/side panel may only open synchronously inside the user-action handler.
  const openGestureBound = (call: () => Promise<void>) => {
    try {
      call().catch(flash);
    } catch {
      flash();
    }
  };

  const openWindow = (windowId: number | undefined) => {
    const run = async () => {
      if (windowId !== undefined) await ports.session.setTargetWindow(windowId);
      const existing = await ports.session.getPanelWindow();
      if (existing !== undefined && (await ports.windows.exists(existing))) {
        await ports.windows.focus(existing);
        return;
      }
      const id = await ports.windows.create(ports.panelUrl, WINDOW_WIDTH, WINDOW_HEIGHT);
      await ports.session.setPanelWindow(id);
    };
    // Serialised so a rapid double click cannot open two windows.
    const next = queue.then(run, run).catch(flash);
    queue = next;
    return next;
  };

  return {
    currentMode(): OpenMode | undefined {
      return cached ?? ports.mirror?.get();
    },

    async apply(mode: OpenMode): Promise<void> {
      if (mode === "panel" && !ports.sidePanel && !ports.sidebar) throw new Error("unsupported");
      await ports.setPopup(mode === "popup" ? "popup.html" : "");
      await ports.sidePanel?.setOpenOnActionClick(mode === "panel");
      ports.mirror?.set(mode);
      cached = mode;
    },

    /** Not awaited before the gesture-bound calls: they must run in the synchronous part. */
    onActionClick(mode: OpenMode, tab: { windowId?: number }): Promise<void> {
      if (mode === "panel") {
        if (ports.sidebar) {
          const sidebar = ports.sidebar;
          openGestureBound(() => sidebar.open());
        }
        return Promise.resolve();
      }
      if (mode === "window") return openWindow(tab.windowId);
      return Promise.resolve();
    },

    /** Locked-fill triggers: opens the surface the user chose instead of the popup. */
    open(mode: OpenMode, windowId?: number): Promise<void> {
      if (mode === "panel") {
        if (ports.sidebar) {
          const sidebar = ports.sidebar;
          openGestureBound(() => sidebar.open());
        } else if (ports.sidePanel && windowId !== undefined) {
          const panel = ports.sidePanel;
          openGestureBound(() => panel.open(windowId));
        } else {
          flash();
        }
        return Promise.resolve();
      }
      if (mode === "window") return openWindow(windowId);
      return Promise.resolve();
    },
  };
}

export type Launcher = ReturnType<typeof createLauncher>;
