import { systemClock, webRandom, type StoragePort } from "@otp-vault/core";
import { browser, type Browser } from "wxt/browser";
import { clearClipboardInDocument, OFFSCREEN_CHANNEL } from "./clipboard";
import type { Platform } from "./ports";

export function storagePort(area: Browser.storage.StorageArea): StoragePort {
  return {
    get: async (keys) =>
      (keys === undefined ? await area.get() : await area.get(keys)) as Record<string, unknown>,
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
  };
}

const clearMessage = { channel: OFFSCREEN_CHANNEL, type: "clear" };

async function clearViaOffscreen(): Promise<void> {
  try {
    await browser.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [browser.offscreen.Reason.CLIPBOARD],
      justification: "Clear a copied 2FA code from the clipboard",
    });
  } catch {
    // Already open from an earlier clear.
  }
  try {
    try {
      await browser.runtime.sendMessage(clearMessage);
    } catch {
      // The new document may not have registered its listener yet.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await browser.runtime.sendMessage(clearMessage);
    }
  } finally {
    await browser.offscreen.closeDocument().catch(() => {});
  }
}

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
        if (!import.meta.env.FIREFOX) return clearViaOffscreen();
        // The Firefox background is an event page with a document.
        if (!clearClipboardInDocument(document)) await navigator.clipboard.writeText("");
      },
    },
    clock: systemClock,
    random: webRandom,
  };
}
