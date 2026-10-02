import type { TabsPort } from "../platform/ports";

/**
 * Shortcut and menu entry point. The locked check and openPopup run synchronously, before any await:
 * Firefox only allows action.openPopup while the user-action context is alive.
 * If the key turns out to be cached the service call may still fill, which is harmless.
 */
export function handleUserTrigger(
  service: { isUnlockedInMemory(): boolean; flashBadge(text: string): Promise<void> },
  tabs: Pick<TabsPort, "openPopup">,
  run: () => Promise<void>,
): Promise<void> {
  if (!service.isUnlockedInMemory()) {
    tabs
      .openPopup()
      .then((opened) => (opened ? undefined : service.flashBadge("?")))
      .catch(() => undefined);
  }
  return run();
}
