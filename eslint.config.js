import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.output/**",
      "**/.wxt/**",
      ".superpowers/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "chrome", message: "core platformdan bağımsız kalmalı (spec §3.1)" },
        { name: "browser", message: "core platformdan bağımsız kalmalı (spec §3.1)" },
      ],
    },
  },
  {
    files: ["apps/extension/src/background/**/*.ts", "apps/extension/src/rpc/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "chrome",
          message: "Arka plan mantığı tarayıcıdan bağımsız kalmalı; Platform portunu kullan.",
        },
        {
          name: "browser",
          message: "Arka plan mantığı tarayıcıdan bağımsız kalmalı; Platform portunu kullan.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["wxt", "wxt/*"],
              message: "src/background ve src/rpc tarayıcıdan bağımsız kalmalı.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/extension/src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "chrome", message: "The UI reaches the browser only through UiPlatform." },
        { name: "browser", message: "The UI reaches the browser only through UiPlatform." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["wxt", "wxt/*"],
              message: "The UI reaches the browser only through UiPlatform.",
            },
          ],
        },
      ],
    },
  },
  {
    // Popup bundle: runtime imports of core, zod and the background modules would pull them in.
    files: [
      "apps/extension/src/ui/popup/**/*.{ts,tsx}",
      "apps/extension/src/ui/components/**/*.{ts,tsx}",
      "apps/extension/src/ui/hooks.ts",
      "apps/extension/src/ui/format.ts",
      "apps/extension/src/ui/errors.ts",
      "apps/extension/src/ui/i18n/**/*.ts",
      "apps/extension/src/ui/platform.ts",
      "apps/extension/src/rpc/client.ts",
      "apps/extension/src/rpc/channel.ts",
      "apps/extension/src/platform/uiPlatform.ts",
      "apps/extension/src/platform/browserRpc.ts",
      "apps/extension/entrypoints/popup/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@otp-vault/core",
              allowTypeImports: true,
              message:
                "Popup bundle: import core at runtime only from the background or manage pages.",
            },
            {
              name: "zod",
              allowTypeImports: true,
              message: "Popup bundle: zod belongs to the background and manage pages.",
            },
          ],
          patterns: [
            {
              group: ["**/background/*"],
              allowTypeImports: true,
              message: "Popup bundle: import background modules as types only.",
            },
            {
              group: [
                "**/rpc/protocol",
                "**/rpc/server",
                "**/zodConfig",
                "**/platform/browserPlatform",
                "**/manage/**",
                "**/qr/**",
                "zxing-wasm",
                "zxing-wasm/*",
              ],
              allowTypeImports: true,
              message: "Popup bundle: these modules belong to the background or manage pages.",
            },
          ],
        },
      ],
    },
  },
);
