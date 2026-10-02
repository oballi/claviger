import "../src/zodConfig";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { VaultService } from "../src/background/vaultService";
import { createBrowserPlatform } from "../src/platform/browserPlatform";
import { handleRpcMessage, isRpcEnvelope } from "../src/rpc/server";

// Firefox may not report screen lock as "locked", so 5 minutes idle counts as locked there (spec 5.4).
const IDLE_DETECTION_SECONDS = 300;

const MENU_ID = "fill-code-menu";

// Name only: error messages could carry vault data.
const logFailure = (e: unknown) =>
  console.error("background task failed:", e instanceof Error ? e.name : "error");

export default defineBackground(() => {
  const service = new VaultService(createBrowserPlatform());
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

  // removeAll first: create() fails on a duplicate id, and onInstalled also fires on every update.
  const registerMenu = () => {
    void browser.contextMenus.removeAll().then(() => {
      browser.contextMenus.create({
        id: MENU_ID,
        title: browser.i18n.getMessage("menuFill"),
        contexts: ["editable"],
      });
    });
  };

  browser.commands.onCommand.addListener((command) => {
    if (command === "fill-code") service.fillFromCommand().catch(logFailure);
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined || !tab.url) return;
    service
      .fillFromMenu({ id: tab.id, url: tab.url }, info.frameId, info.frameUrl)
      .catch(logFailure);
  });

  browser.runtime.onStartup.addListener(registerMenu);

  browser.runtime.onInstalled.addListener((details) => {
    registerMenu();
    if (details.reason === "install")
      void browser.tabs.create({ url: `${browser.runtime.getURL("/manage.html")}#/setup` });
  });
});
