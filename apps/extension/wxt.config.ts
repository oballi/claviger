import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  imports: false,
  hooks: {
    // WXT 0.21.4, `imports: false` olsa bile unimport dönüşümünü çalıştırıyor ve `storage` adlı
    // parametreleri global sanıp core'a `wxt/utils/storage` import'u enjekte ediyor. Kapat.
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
              // AMO, Kasım 2025'ten beri yeni eklentilerde zorunlu tutuyor; hiçbir veri toplanmıyor.
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : { minimum_chrome_version: "116" }),
  }),
});
