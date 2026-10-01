import { browser } from "wxt/browser";
import type { ManageRoute, UiPlatform } from "../ui/platform";
import { rpc } from "./browserRpc";

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
      void browser.tabs.create({ url: `${browser.runtime.getURL("/manage.html")}${hash}` });
      window.close();
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
