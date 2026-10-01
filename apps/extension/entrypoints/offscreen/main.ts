import { browser } from "wxt/browser";
import { handleOffscreenMessage } from "../../src/platform/clipboard";

browser.runtime.onMessage.addListener((message, sender) =>
  handleOffscreenMessage(message, sender, browser.runtime.id, document),
);
