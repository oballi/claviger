// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// jsdom ships no types; only this narrow surface is used.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: object,
  ) => { window: { document: Document; eval(code: string): unknown } };
};

type Fill = (code: string, explicit: boolean, domain: string) => string;

// Brace matching is enough here: the filler has no string or template literal with unbalanced braces.
function extractFillOtp(bundle: string): string {
  const start = bundle.search(/function [\w$]+\(\w+,\w+,\w+\)\{[^{}]*?location\.protocol/);
  if (start < 0) throw new Error("fillOtp not found in the bundle");
  const open = bundle.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < bundle.length; i++) {
    if (bundle[i] === "{") depth++;
    if (bundle[i] === "}" && --depth === 0) return bundle.slice(start, i + 1);
  }
  throw new Error("unbalanced fillOtp source");
}

function inPage(source: string, url: string): { fn: Fill; input: HTMLInputElement } {
  const dom = new JSDOM(`<input id="o" autocomplete="one-time-code">`, {
    url,
    runScripts: "outside-only",
  });
  const input = dom.window.document.getElementById("o") as HTMLInputElement;
  input.getClientRects = () => [{ width: 10, height: 10 }] as unknown as DOMRectList;
  // Evaluated inside the window, so the function sees only the page's globals.
  const fn = dom.window.eval(`(${source})`) as Fill;
  return { fn, input };
}

// Needs a build first (`pnpm --filter @otp-vault/extension build` and `build:firefox`).
for (const dir of ["chrome-mv3", "firefox-mv3"]) {
  const file = new URL(`../.output/${dir}/background.js`, import.meta.url);
  const present = existsSync(file);
  if (!present)
    console.warn(`SKIPPED built-fill (${dir}): ${file.pathname} not found, build first`);
  describe.skipIf(!present)(`built fillOtp (${dir})`, () => {
    const source = present ? extractFillOtp(readFileSync(file, "utf8")) : "";

    it("has no esbuild helper calls that would break after serialization", () => {
      expect(source).not.toMatch(/__name\(/);
    });

    it("fills a one-time-code field in a bare page", () => {
      const { fn, input } = inPage(source, "https://login.bank.com/");
      expect(fn("123456", false, "bank.com")).toBe("filled");
      expect(input.value).toBe("123456");
    });

    it("refuses a look-alike host", () => {
      const { fn, input } = inPage(source, "https://bank.com.evil.io/");
      expect(fn("123456", false, "bank.com")).toBe("wrong-site");
      expect(input.value).toBe("");
    });
  });
}
