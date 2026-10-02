import type { TabsPort } from "../platform/ports";

/**
 * Shortcut and menu entry point.
 * Firefox only allows action.openPopup while the user-action context is alive, so there the locked
 * check and openPopup run synchronously before any await. isUnlockedInMemory() is false after a
 * service worker suspension even when the cached key still works, so Chrome instead asks the
 * service and opens the popup only once it reports the vault is locked.
 */
export async function handleUserTrigger(
  service: { isUnlockedInMemory(): boolean; flashBadge(text: string): Promise<void> },
  tabs: Pick<TabsPort, "openPopup">,
  run: () => Promise<"locked" | "done" | void>,
  firefox: boolean,
): Promise<void> {
  const openPopup = () =>
    tabs
      .openPopup()
      .then((opened) => (opened ? undefined : service.flashBadge("?")))
      .catch(() => undefined);
  if (firefox) {
    if (!service.isUnlockedInMemory()) void openPopup();
    await run();
    return;
  }
  if ((await run()) === "locked") await openPopup();
}

/** Lock shortcut: never opens a popup or the launcher, so it cannot leave a prompt over a locked vault. */
export async function handleLockCommand(service: {
  lock(): Promise<void>;
  flashBadge(text: string): Promise<void>;
}): Promise<void> {
  await service.lock();
  await service.flashBadge("LOCK");
}
