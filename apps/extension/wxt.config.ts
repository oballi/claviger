import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  vite: () => ({ plugins: [tailwindcss()] }),
  hooks: {
    // WXT 0.21.4 runs the unimport transform even with `imports: false`, treats parameters named `storage`
    // as globals and injects a `wxt/utils/storage` import into core. Hence disabled.
    "config:resolved": (wxt) => {
      Object.assign(wxt.config.imports, { autoImport: false });
    },
  },
  manifest: ({ browser }) => ({
    name: "otp-vault",
    description: "Şifreli, açık kaynak iki adımlı doğrulama kodları.",
    version: "0.0.1",
    permissions: ["storage", "alarms", "idle", "activeTab", "scripting"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "otp-vault@otp-vault.dev",
              strict_min_version: "128.0",
              // AMO has required this for new extensions since Nov 2025; no data is collected.
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : { minimum_chrome_version: "116" }),
  }),
});
