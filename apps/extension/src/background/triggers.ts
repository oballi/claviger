import type { OpenMode } from "@claviger/ui/protocol";
import type { TabsPort } from "../platform/ports";

export interface TriggerUi {
  /** Synchronous: in-memory cache (Chrome) or localStorage mirror (Firefox). */
  currentMode(): OpenMode | undefined;
  /** Asynchronous fallback after a cold start; only usable where no user gesture is needed. */
  resolveMode(): Promise<OpenMode>;
  open(mode: OpenMode, windowId?: number): Promise<void>;
}

/**
 * Shortcut and menu entry point.
 * Firefox only allows action.openPopup and sidebarAction.open while the user-action context is
 * alive, so there the locked check and the open call run synchronously before any await.
 * isUnlockedInMemory() is false after a service worker suspension even when the cached key still
 * works, so Chrome instead asks the service and opens the popup only once it reports the vault is
 * locked. chrome.sidePanel.open needs the gesture too, so panel mode opens it synchronously from
 * the in-memory mode cache; with a cold cache the badge flashes "?" instead of a lost gesture.
 */
export async function handleUserTrigger(
  service: { isUnlockedInMemory(): boolean; flashBadge(text: string): Promise<void> },
  tabs: Pick<TabsPort, "openPopup">,
  run: () => Promise<"locked" | "done" | void>,
  firefox: boolean,
  opts: { ui?: TriggerUi; windowId?: number } = {},
): Promise<void> {
  const { ui, windowId } = opts;
  const openPopup = () =>
    tabs
      .openPopup()
      .then((opened) => (opened ? undefined : service.flashBadge("?")))
      .catch(() => undefined);
  const mode = ui?.currentMode();
  if (firefox) {
    if (!service.isUnlockedInMemory()) {
      if (ui && (mode === "panel" || mode === "window")) void ui.open(mode, windowId);
      else void openPopup();
    }
    await run();
    return;
  }
  let openedPanel = false;
  if (ui && mode === "panel" && !service.isUnlockedInMemory()) {
    void ui.open("panel", windowId);
    openedPanel = true;
  }
  if ((await run()) !== "locked" || openedPanel) return;
  const resolved = mode ?? (await ui?.resolveMode().catch(() => undefined));
  if (ui && resolved === "window") await ui.open("window", windowId);
  else if (resolved === "panel") await service.flashBadge("?");
  else await openPopup();
}

/** Lock shortcut: never opens a popup or the launcher, so it cannot leave a prompt over a locked vault. */
export async function handleLockCommand(service: {
  lock(): Promise<void>;
  flashBadge(text: string): Promise<void>;
}): Promise<void> {
  await service.lock();
  await service.flashBadge("LOCK");
}
