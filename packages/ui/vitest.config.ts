import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Removed in Task 4, when the first package tests arrive.
    passWithNoTests: true,
  },
});
