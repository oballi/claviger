import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("../../../packages/ui/src/styles.css");

describe("focus styling", () => {
  it("replaces the outline on text-like fields with a 2px underline", () => {
    const rule = css.match(
      /input:is\(([\s\S]*?)\):focus-visible,\s*textarea:focus-visible\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    for (const type of ["text", "password", "search", "email", "tel", "number", "url"]) {
      expect(rule?.[1]).toContain(`[type="${type}"]`);
    }
    expect(rule?.[2]).toContain("outline: 2px solid transparent");
    expect(rule?.[2]).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--ov-text\)/);
  });

  it("keeps the outline for everything else", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline: 2px solid var\(--ov-text\)/);
  });

  it("moves the underline to the wrapper of bare inputs", () => {
    expect(css).toMatch(/\.ov-line:has\(input:focus-visible\)/);
    for (const file of [
      "../../../packages/ui/src/popup/CodesScreen.tsx",
      "../../../packages/ui/src/manage/AccountsScreen.tsx",
      "../../../packages/ui/src/components/LockScreen.tsx",
    ]) {
      expect(read(file)).toContain("ov-line");
      expect(read(file)).toContain("data-bare");
    }
  });
});

describe("theme tokens", () => {
  it("keeps light on :root and applies dark under the media query and data-theme", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--ov-bg:\s*#f6f5f2/i);
    const media = css.match(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/,
    );
    expect(media?.[1]).toMatch(/--ov-bg:\s*#121214/i);
    expect(media?.[1]).toMatch(/--ov-hover:\s*#1c1c1f/i);
    const forced = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
    expect(forced?.[1]).toMatch(/--ov-bg:\s*#121214/i);
    expect(forced?.[1]).toContain("color-scheme: dark");
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{[^}]*color-scheme: light/);
    expect(css).toMatch(/--ov-hover:\s*#eeede9/i);
  });

  it("keeps a hover ring and drops the transition for reduced motion", () => {
    expect(css).toMatch(/\.ov-row\s*\{/);
    expect(css).toContain("inset 0 0 0 1px var(--ov-hair)");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.ov-row[\s\S]*transition:\s*none/);
  });
});
