import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/.output/**", "**/.wxt/**"],
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
);
