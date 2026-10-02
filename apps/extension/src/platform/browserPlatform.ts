import { systemClock, webRandom, type StoragePort } from "@otp-vault/core";
import { browser, type Browser } from "wxt/browser";
import { clearClipboardInDocument, clearViaOffscreen, type OffscreenPort } from "./clipboard";
import { fillOtp, type FillResult } from "../inject/fillOtp";
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
    tabs: {
      async active() {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        return tab?.id !== undefined && tab.url ? { id: tab.id, url: tab.url } : null;
      },
      async url(tabId) {
        try {
          return (await browser.tabs.get(tabId)).url ?? null;
        } catch {
          return null;
        }
      },
      async fill(tabId, frameId, code, explicit, expectedDomain) {
        try {
          const [result] = await browser.scripting.executeScript({
            target: frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] },
            func: fillOtp,
            args: [code, explicit, expectedDomain],
          });
          return (result?.result as FillResult | undefined) ?? null;
        } catch {
          // Restricted pages (browser UI, stores) and pages without an activeTab grant.
          return null;
        }
      },
      async setBadge(text) {
        await browser.action.setBadgeText({ text });
      },
      async openPopup() {
        try {
          await browser.action.openPopup();
          return true;
        } catch {
          return false;
        }
      },
    },
    clock: systemClock,
    random: webRandom,
  };
}
