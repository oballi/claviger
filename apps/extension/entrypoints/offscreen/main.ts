import { browser } from "wxt/browser";
import { clearClipboardInDocument, isOffscreenClear } from "../../src/platform/clipboard";

browser.runtime.onMessage.addListener((message, sender) => {
  if (!isOffscreenClear(message) || sender.id !== browser.runtime.id) return undefined;
  return Promise.resolve(clearClipboardInDocument(document));
});
