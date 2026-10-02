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
      "**/.output-smoke/**",
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
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "chrome", message: "packages/ui reaches the platform only through UiPlatform." },
        { name: "browser", message: "packages/ui reaches the platform only through UiPlatform." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["wxt", "wxt/*"],
              message: "packages/ui reaches the platform only through UiPlatform.",
            },
            {
              group: ["@tauri-apps/*"],
              message: "packages/ui reaches the platform only through UiPlatform.",
            },
            {
              group: ["@otp-vault/extension", "@otp-vault/extension/*", "**/apps/**"],
              message: "packages/ui must not depend on an app.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/extension/src/scan/**/*.{ts,tsx}"],
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
                "@otp-vault/ui/protocol",
                "@otp-vault/ui/zod-config",
                "@otp-vault/ui/manage",
                "@otp-vault/ui/testing",
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
  {
    // Popup-safe package modules: runtime zod/core/protocol would leak into the popup bundle.
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/ui/src/manage/**",
      "packages/ui/src/protocol/**",
      "packages/ui/src/testing/**",
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
            { name: "@otp-vault/core", allowTypeImports: true, message: "Popup-safe module." },
            { name: "zod", allowTypeImports: true, message: "Popup-safe module." },
          ],
          patterns: [
            {
              group: [
                "**/protocol",
                "**/protocol/*",
                "**/zod-config",
                "**/zodConfig",
                "**/manage",
                "**/manage/*",
                "**/testing",
                "**/testing/*",
              ],
              allowTypeImports: true,
              message: "Popup-safe module: import protocol and manage code as types only.",
            },
          ],
        },
      ],
    },
  },
);
