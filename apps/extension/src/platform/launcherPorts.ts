import { browser } from "wxt/browser";
import type { OpenMode } from "@claviger/ui/protocol";
import type { LauncherPorts } from "../background/launcher";
import { TARGET_WINDOW_KEY } from "./uiPlatform";

const PANEL_WINDOW_KEY = "claviger-panel-window";
const MIRROR_KEY = "claviger-open-mode";
const MODES: readonly string[] = ["popup", "window", "panel"];

interface SidebarActionApi {
  open(): Promise<void>;
}

export function createBrowserLauncherPorts(
  flashBadge: (text: string) => Promise<void>,
): LauncherPorts {
  const firefox = import.meta.env.FIREFOX;
  const sidebarApi = (browser as unknown as { sidebarAction?: SidebarActionApi }).sidebarAction;
  return {
    setPopup: (path) => browser.action.setPopup({ popup: path }),
    ...(!firefox && browser.sidePanel
      ? {
          sidePanel: {
            // Chrome persists this itself, so panel mode needs no click handler.
            setOpenOnActionClick: (open: boolean) =>
              browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: open }),
            open: (windowId: number) => browser.sidePanel.open({ windowId }),
          },
        }
      : {}),
    ...(firefox && sidebarApi ? { sidebar: { open: () => sidebarApi.open() } } : {}),
    // Event-page localStorage is readable synchronously; storage APIs are not.
    ...(firefox
      ? {
          mirror: {
            get: () => {
              try {
                const value = localStorage.getItem(MIRROR_KEY);
                return value !== null && MODES.includes(value) ? (value as OpenMode) : undefined;
              } catch {
                return undefined;
              }
            },
            set: (mode: OpenMode) => {
              try {
                localStorage.setItem(MIRROR_KEY, mode);
              } catch {
                // Without the mirror a cold click falls back to the async path.
              }
            },
          },
        }
      : {}),
    windows: {
      async create(url, width, height) {
        const created = await browser.windows.create({ url, type: "popup", width, height });
        if (created?.id === undefined) throw new Error("no window id");
        return created.id;
      },
      async focus(id) {
        await browser.windows.update(id, { focused: true });
      },
      async exists(id) {
        try {
          await browser.windows.get(id);
          return true;
        } catch {
          return false;
        }
      },
    },
    session: {
      async getPanelWindow() {
        const value = (await browser.storage.session.get(PANEL_WINDOW_KEY))[PANEL_WINDOW_KEY];
        return typeof value === "number" ? value : undefined;
      },
      async setPanelWindow(id) {
        if (id === undefined) await browser.storage.session.remove(PANEL_WINDOW_KEY);
        else await browser.storage.session.set({ [PANEL_WINDOW_KEY]: id });
      },
      setTargetWindow: (id) => browser.storage.session.set({ [TARGET_WINDOW_KEY]: id }),
    },
    flashBadge,
    panelUrl: browser.runtime.getURL("/sidepanel.html"),
  };
}
