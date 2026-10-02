import { browser } from "wxt/browser";
import type { ManageRoute, UiPlatform } from "../ui/platform";
import { rpc } from "./browserRpc";

async function findManageTab(
  manageUrl: string,
): Promise<{ tabId: number; windowId: number } | null> {
  try {
    if (browser.runtime.getContexts) {
      const [ctx] = await browser.runtime.getContexts({
        contextTypes: ["TAB"],
        documentUrls: [manageUrl],
      });
      if (ctx && ctx.tabId >= 0) return { tabId: ctx.tabId, windowId: ctx.windowId };
    }
  } catch {
    // fall through to getViews
  }
  try {
    type View = { location: Location; browser?: typeof browser };
    for (const view of browser.extension.getViews({ type: "tab" }) as unknown as View[]) {
      if (view.location.pathname !== "/manage.html") continue;
      // The view's own API object is the only way to learn its tab id without the "tabs" permission.
      const tab = await view.browser?.tabs.getCurrent();
      if (tab?.id !== undefined) return { tabId: tab.id, windowId: tab.windowId };
    }
  } catch {
    // no reusable tab
  }
  return null;
}

async function openOrFocusManage(hash: string): Promise<void> {
  const manageUrl = browser.runtime.getURL("/manage.html");
  try {
    const found = await findManageTab(manageUrl);
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
