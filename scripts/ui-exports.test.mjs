import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../packages/ui");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// A stale target silently breaks imports or tree-shaking exemptions (zod jitless config).
test("every @otp-vault/ui export target exists", () => {
  for (const [key, target] of Object.entries(pkg.exports)) {
    assert.ok(existsSync(join(root, target)), `exports["${key}"] -> ${target} is missing`);
  }
});

test("every concrete sideEffects entry exists", () => {
  for (const entry of pkg.sideEffects) {
    if (entry.includes("*")) continue;
    assert.ok(existsSync(join(root, entry)), `sideEffects entry ${entry} is missing`);
  }
});
