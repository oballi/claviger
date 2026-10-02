import "../src/zodConfig";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createLauncher } from "../src/background/launcher";
import { handleLockCommand, handleUserTrigger, type TriggerUi } from "../src/background/triggers";
import { VaultService } from "../src/background/vaultService";
import { createBrowserPlatform } from "../src/platform/browserPlatform";
import { createBrowserLauncherPorts } from "../src/platform/launcherPorts";
import { handleRpcMessage, isRpcEnvelope, isTrustedSender } from "../src/rpc/server";

// Firefox may not report screen lock as "locked", so 5 minutes idle counts as locked there (spec 5.4).
const IDLE_DETECTION_SECONDS = 300;

const MENU_ID = "fill-code-menu";

// Name only: error messages could carry vault data.
const logFailure = (e: unknown) =>
  console.error("background task failed:", e instanceof Error ? e.name : "error");

export default defineBackground(() => {
  const platform = createBrowserPlatform();
  // `service` is only read when an event fires, long after construction.
  const launcher = createLauncher(createBrowserLauncherPorts((text) => service.flashBadge(text)));
  const service = new VaultService(platform, (mode) => launcher.apply(mode));
  const triggerUi: TriggerUi = {
    currentMode: () => launcher.currentMode(),
    resolveMode: async () => (await service.getState()).openMode,
    open: (mode, windowId) => launcher.open(mode, windowId),
  };
  // setPopup does not survive a browser restart; setPanelBehavior is stored but re-applying is cheap.
  const reapplyOpenMode = () => service.reapplyOpenMode().catch(logFailure);
  reapplyOpenMode();
  const ctx = {
    extensionId: browser.runtime.id,
    // URL.origin can be "null" for Firefox's moz-extension: scheme, so derive the prefix directly.
    extensionOrigin: browser.runtime.getURL("/popup.html").replace(/popup\.html$/, ""),
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRpcEnvelope(message)) return false;
    void handleRpcMessage(service, message, sender, ctx).then(sendResponse, () =>
      sendResponse({ ok: false, error: { code: "internal", message: "Unexpected error" } }),
    );
    return true;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    service.handleAlarm(alarm.name).catch(logFailure);
  });

  browser.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  browser.idle.onStateChanged.addListener((state) => {
    service.handleIdleState(state, { idleMeansLocked: import.meta.env.FIREFOX }).catch(logFailure);
  });

  // The menu title comes from _locales, so it follows the browser language, not the in-app language.
  // removeAll first: create() fails on a duplicate id, and onInstalled also fires on every update.
  const registerMenu = () => {
    browser.contextMenus
      .removeAll()
      .then(() => {
        browser.contextMenus.create({
          id: MENU_ID,
          title: browser.i18n.getMessage("menuFill"),
          contexts: ["editable"],
        });
      })
      .catch(logFailure);
  };

  const runFillCommand = (windowId?: number) =>
    handleUserTrigger(
      service,
      platform.tabs,
      () => service.fillFromCommand(),
      import.meta.env.FIREFOX,
      { ui: triggerUi, windowId },
    );

  // Fires only while the popup is cleared (window mode, Firefox panel). The gesture-bound sidebar
  // open must run in this synchronous part, so the mode comes from the cache or the mirror.
  browser.action.onClicked.addListener((tab) => {
    const mode = launcher.currentMode();
    if (mode) {
      void launcher.onActionClick(mode, tab);
      return;
    }
    // Cold Chrome worker: only window mode needs a click handler there and it is not gesture-bound.
    service
      .getState()
      .then((state) => launcher.onActionClick(state.openMode, tab))
      .catch(logFailure);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === "fill-code") runFillCommand(tab?.windowId).catch(logFailure);
    if (command === "lock-vault") handleLockCommand(service).catch(logFailure);
  });

  if (__SMOKE__) {
    // Drives the shortcut path without a real key press; compiled out of release builds.
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.channel !== "claviger/smoke-fill" || !isTrustedSender(sender, ctx)) return false;
      runFillCommand().then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    });
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined || !tab.url) return;
    const target = { id: tab.id, url: tab.url };
    handleUserTrigger(
      service,
      platform.tabs,
      () => service.fillFromMenu(target, info.frameId, info.frameUrl),
      import.meta.env.FIREFOX,
      { ui: triggerUi, windowId: tab.windowId },
    ).catch(logFailure);
  });

  browser.runtime.onStartup.addListener(() => {
    registerMenu();
    reapplyOpenMode();
  });

  browser.runtime.onInstalled.addListener((details) => {
    registerMenu();
    reapplyOpenMode();
    if (details.reason === "install")
      void browser.tabs.create({ url: `${browser.runtime.getURL("/manage.html")}#/setup` });
  });
});
