import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup-dom.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/platform/browserRpc.ts",
        "src/platform/uiPlatform.ts",
        "src/ui/StatusPlaceholder.tsx",
      ],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
