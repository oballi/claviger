import "../src/zodConfig";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { VaultService } from "../src/background/vaultService";
import { createBrowserPlatform } from "../src/platform/browserPlatform";
import { handleRpcMessage, isRpcEnvelope } from "../src/rpc/server";

// Firefox may not report screen lock as "locked", so 5 minutes idle counts as locked there (spec 5.4).
const IDLE_DETECTION_SECONDS = 300;

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

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install")
      void browser.tabs.create({ url: `${browser.runtime.getURL("/manage.html")}#/setup` });
  });
});
