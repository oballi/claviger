import { systemClock, webRandom, type StoragePort } from "@otp-vault/core";
import { browser, type Browser } from "wxt/browser";
import { clearClipboardInDocument, clearViaOffscreen, type OffscreenPort } from "./clipboard";
import type { Platform } from "./ports";

export function storagePort(area: Browser.storage.StorageArea): StoragePort {
  return {
    get: async (keys) =>
      (keys === undefined ? await area.get() : await area.get(keys)) as Record<string, unknown>,
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
  };
}

const offscreenPort: OffscreenPort = {
  createDocument: () =>
    browser.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [browser.offscreen.Reason.CLIPBOARD],
      justification: "Clear a copied 2FA code from the clipboard",
    }),
  closeDocument: () => browser.offscreen.closeDocument(),
  sendMessage: (message) => browser.runtime.sendMessage(message),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function createBrowserPlatform(): Platform {
  return {
    local: storagePort(browser.storage.local),
    sync: storagePort(browser.storage.sync),
    session: storagePort(browser.storage.session),
    alarms: {
      create: async (name, delayMinutes) => {
        await browser.alarms.create(name, { delayInMinutes: delayMinutes });
      },
      clear: async (name) => {
        await browser.alarms.clear(name);
      },
    },
    clipboard: {
      clear: async () => {
        if (!import.meta.env.FIREFOX) return clearViaOffscreen(offscreenPort);
        // The Firefox background is an event page with a document.
        if (!clearClipboardInDocument(document)) await navigator.clipboard.writeText("");
      },
    },
    clock: systemClock,
    random: webRandom,
  };
}
