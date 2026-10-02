import { browser, type Browser } from "wxt/browser";
import type { ManageRoute, UiPlatform } from "@claviger/ui";
import { rpc } from "./browserRpc";

const CLOCK_ORIGIN = "https://www.google.com/*";
const CLOCK_URL = "https://www.google.com/generate_204";

/** The launcher stores the browsing window here in window mode (session storage, never synced). */
export const TARGET_WINDOW_KEY = "claviger-target-window";

type Context = "popup" | "manage" | "scan" | "panel";

/**
 * The window whose tabs the panel or window page acts on. A side panel lives inside that window;
 * a detached window has no tabs of its own, so it follows the window the launcher stored.
 */
async function targetWindowId(context: Context): Promise<number | undefined> {
  if (context !== "panel") return undefined;
  try {
    const own = await browser.windows.getCurrent();
    if (own.type === "normal") return own.id;
    const stored = (await browser.storage.session.get(TARGET_WINDOW_KEY))[TARGET_WINDOW_KEY];
    return typeof stored === "number" ? stored : undefined;
  } catch {
    return undefined;
  }
}

/** A URL-less tab (new tab, restricted page) counts as no tab at all. */
async function queryActiveTab(
  context: Context,
): Promise<{ windowId: number | undefined; tab: Browser.tabs.Tab | undefined }> {
  if (context === "panel") {
    const windowId = await targetWindowId(context);
    if (windowId === undefined) return { windowId, tab: undefined };
    const [tab] = await browser.tabs.query({ active: true, windowId });
    return { windowId, tab };
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { windowId: undefined, tab };
}

async function findManageTab(): Promise<{ tabId: number; windowId: number } | null> {
  const origin = new URL(browser.runtime.getURL("/")).origin;
  const isManage = (documentUrl: string | undefined) => {
    try {
      const url = new URL(documentUrl ?? "");
      return url.origin === origin && url.pathname === "/manage.html";
    } catch {
      return false;
    }
  };
  // No documentUrls filter: it matches the exact URL, so a tab on a hash route would be missed.
  const contexts = await browser.runtime.getContexts({ contextTypes: ["TAB"] });
  const ctx = contexts.find((c) => isManage(c.documentUrl) && c.tabId >= 0);
  return ctx ? { tabId: ctx.tabId, windowId: ctx.windowId } : null;
}

async function openOrFocusManage(hash: string, windowId: number | undefined): Promise<void> {
  const manageUrl = browser.runtime.getURL("/manage.html");
  try {
    const found = await findManageTab();
    if (found) {
      await browser.tabs.update(found.tabId, { active: true, url: `${manageUrl}${hash}` });
      await browser.windows.update(found.windowId, { focused: true });
      return;
    }
  } catch {
    // fall back to a new tab
  }
  await browser.tabs.create({ url: `${manageUrl}${hash}`, ...(windowId ? { windowId } : {}) });
}

/** The popup opens the manage page in a new tab; the manage page itself only changes its hash. */
export function createBrowserUiPlatform(
  context: Context,
  extra: Partial<UiPlatform> = {},
): UiPlatform {
  return {
    ...extra,
    rpc,
    reportsScreenLock: !import.meta.env.FIREFOX,
    capabilities: {
      activeTab: true,
      qrScan: true,
      autofill: true,
      clockCheck: true,
      storageArea: true,
    },
    copy: (text) => navigator.clipboard.writeText(text),
    openManage(route?: ManageRoute) {
      const hash = route ? `#/${route}` : "";
      if (context === "manage") {
        window.location.hash = hash;
        return;
      }
      void targetWindowId(context)
        .then((windowId) => openOrFocusManage(hash, windowId))
        // Only the popup is dismissed by opening a tab; a panel or window must stay.
        .then(() => context === "popup" && window.close());
    },
    async activeTab() {
      if (context !== "popup" && context !== "panel") return undefined;
      const { tab } = await queryActiveTab(context);
      return tab?.id === undefined || !tab.url ? undefined : { id: tab.id, url: tab.url };
    },
    onActiveTabChange:
      context === "panel"
        ? (listener) => {
            // Any of these can change which tab "this site" means; the listener re-resolves.
            const events = [
              browser.tabs.onActivated,
              browser.tabs.onUpdated,
              browser.windows.onRemoved,
            ];
            for (const event of events) event.addListener(listener);
            return () => {
              for (const event of events) event.removeListener(listener);
            };
          }
        : undefined,
    async captureTab() {
      if (context !== "popup" && context !== "panel") return null;
      try {
        const { windowId, tab: before } = await queryActiveTab(context);
        if (!before?.url) return null;
        // Capture first: the activeTab grant and the rate limit favour the earliest call.
        const dataUrl = await (windowId === undefined
          ? browser.tabs.captureVisibleTab({ format: "png" })
          : browser.tabs.captureVisibleTab(windowId, { format: "png" }));
        const { tab: after } = await queryActiveTab(context);
        // A navigation in between would link the account to the wrong site.
        if (after?.id !== before.id || after?.url !== before.url) return null;
        return { dataUrl, tabUrl: before.url };
      } catch {
        return null;
      }
    },
    async imageToCapture(image) {
      // Dynamic import keeps canvas code out of the popup's main bundle.
      return (await import("../qr/pngCapture")).imageToPngDataUrl(image);
    },
    openScan(id) {
      void targetWindowId(context)
        .then((windowId) =>
          browser.tabs.create({
            url: `${browser.runtime.getURL("/scan.html")}#${id}`,
            ...(windowId ? { windowId } : {}),
          }),
        )
        .then(() => context === "popup" && window.close());
    },
    requestClockPermission: () => browser.permissions.request({ origins: [CLOCK_ORIGIN] }),
    async removeClockPermission() {
      await browser.permissions.remove({ origins: [CLOCK_ORIGIN] });
    },
    async fetchServerDate() {
      const startMs = Date.now();
      const response = await fetch(CLOCK_URL, {
        method: "HEAD",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      const endMs = Date.now();
      const serverDate = response.headers.get("date");
      if (!serverDate) throw new Error("The response has no Date header");
      return { serverDate, startMs, endMs };
    },
    download(filename, content) {
      const url = URL.createObjectURL(new Blob([content], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    print: () => window.print(),
  };
}
