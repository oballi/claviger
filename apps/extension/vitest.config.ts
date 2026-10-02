import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  define: { __SMOKE__: false },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup-dom.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      // The UI lives in packages/ui but is exercised here against the real VaultService.
      allowExternal: true,
      include: ["src/**/*.{ts,tsx}", "**/packages/ui/src/**/*.{ts,tsx}"],
      exclude: [
        "src/platform/browserRpc.ts",
        "src/platform/uiPlatform.ts",
        "src/qr/imageData.ts",
        "src/scan/crop.ts",
        "**/packages/ui/src/**/index.ts",
        "**/packages/ui/src/testing/**",
        "**/packages/ui/src/contract/views.ts",
        "**/packages/core/**",
      ],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
