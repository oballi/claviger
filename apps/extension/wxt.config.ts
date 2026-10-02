import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Smoke-only: lets the end-to-end test drive fill and capture without a real toolbar click. Never shipped.
const smoke = process.env.SMOKE === "1";

const icons = {
  16: "icon/16.png",
  32: "icon/32.png",
  48: "icon/48.png",
  128: "icon/128.png",
};

export default defineConfig({
  outDir: smoke ? ".output-smoke" : ".output",
  modules: ["@wxt-dev/module-react"],
  imports: false,
  vite: () => ({ plugins: [tailwindcss()], define: { __SMOKE__: JSON.stringify(smoke) } }),
  hooks: {
    // WXT 0.21.4 runs the unimport transform even with `imports: false`, treats parameters named `storage`
    // as globals and injects a `wxt/utils/storage` import into core. Hence disabled.
    "config:resolved": (wxt) => {
      Object.assign(wxt.config.imports, { autoImport: false });
    },
  },
  manifest: ({ browser }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    icons,
    // WXT only fills `icons`; the toolbar needs default_icon explicitly.
    action: { default_icon: icons },
    permissions: [
      "storage",
      "alarms",
      "idle",
      "activeTab",
      "scripting",
      "clipboardWrite",
      "contextMenus",
      ...(browser === "firefox" ? [] : ["offscreen"]),
    ],
    ...(smoke ? { host_permissions: ["<all_urls>"] } : {}),
    optional_host_permissions: ["https://www.google.com/*"],
    commands: {
      "fill-code": {
        suggested_key: { default: "Alt+Shift+O" },
        description: "__MSG_commandFill__",
      },
      // No suggested_key: Chrome allows only 4 suggested shortcuts; the user assigns one.
      "lock-vault": { description: "__MSG_commandLock__" },
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              // New id: Firefox storage is keyed by it.
              id: "claviger@claviger.app",
              strict_min_version: "140.0",
              // AMO has required this for new extensions since Nov 2025; no data is collected.
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : { minimum_chrome_version: "116" }),
  }),
});
