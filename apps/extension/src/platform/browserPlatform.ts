import { systemClock, webRandom, type StoragePort } from "@otp-vault/core";
import { browser, type Browser } from "wxt/browser";
import type { Platform } from "./ports";

export function storagePort(area: Browser.storage.StorageArea): StoragePort {
  return {
    get: async (keys) =>
      (keys === undefined ? await area.get() : await area.get(keys)) as Record<string, unknown>,
    set: (items) => area.set(items),
    remove: (keys) => area.remove(keys),
  };
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
    clock: systemClock,
    random: webRandom,
  };
}
