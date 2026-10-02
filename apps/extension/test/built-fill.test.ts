// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const BUNDLE = new URL("../.output/chrome-mv3/background.js", import.meta.url);

// Brace matching is enough here: the filler has no string or template literal with unbalanced braces.
function extractFillOtp(bundle: string): string {
  const start = bundle.search(
    /function [\w$]+\(\w+,\w+=!1\)\{if\(!\/\^\[0-9A-Z\]\{4,10\}\$\/\.test\(/,
  );
  if (start < 0) throw new Error("fillOtp not found in the bundle");
  const open = bundle.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bundle.length; i++) {
    if (bundle[i] === "{") depth++;
    if (bundle[i] === "}" && --depth === 0) return bundle.slice(start, i + 1);
  }
  throw new Error("unbalanced fillOtp source");
}

// Needs `pnpm --filter @otp-vault/extension build` first; skipped when there is no build output.
describe.skipIf(!existsSync(BUNDLE))("built fillOtp", () => {
  const source = existsSync(BUNDLE) ? extractFillOtp(readFileSync(BUNDLE, "utf8")) : "";

  it("has no esbuild helper calls that would break after serialization", () => {
    expect(source).not.toMatch(/__name\(/);
  });

  it("runs with no outer scope at all", () => {
    const fn = runInNewContext(`(${source})`, Object.create(null)) as (c: string) => string;
    expect(fn("not a code!")).toBe("no-field");
  });
});
