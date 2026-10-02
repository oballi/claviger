import { browser } from "wxt/browser";
import type { ManageRoute, UiPlatform } from "../ui/platform";
import { rpc } from "./browserRpc";

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
  if (browser.runtime.getContexts) {
    const contexts = await browser.runtime.getContexts({ contextTypes: ["TAB"] });
    const ctx = contexts.find((c) => isManage(c.documentUrl) && c.tabId >= 0);
    return ctx ? { tabId: ctx.tabId, windowId: ctx.windowId } : null;
  }
  type View = { location: Location };
  for (const view of browser.extension.getViews({ type: "tab" }) as unknown as View[]) {
    if (view.location.pathname !== "/manage.html") continue;
    const [tab] = await browser.tabs.query({ url: `${origin}/manage.html*` });
    if (tab?.id !== undefined) return { tabId: tab.id, windowId: tab.windowId };
  }
  return null;
}

async function openOrFocusManage(hash: string): Promise<void> {
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
  await browser.tabs.create({ url: `${manageUrl}${hash}` });
}

/** The popup opens the manage page in a new tab; the manage page itself only changes its hash. */
export function createBrowserUiPlatform(context: "popup" | "manage"): UiPlatform {
  return {
    rpc,
    isFirefox: import.meta.env.FIREFOX,
    copy: (text) => navigator.clipboard.writeText(text),
    openManage(route?: ManageRoute) {
      const hash = route ? `#/${route}` : "";
      if (context === "manage") {
        window.location.hash = hash;
        return;
      }
      void openOrFocusManage(hash).then(() => window.close());
    },
    async activeTabUrl() {
      if (context === "manage") return undefined;
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.url;
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
