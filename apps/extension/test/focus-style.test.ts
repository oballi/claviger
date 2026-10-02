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
    expect(rule?.[2]).toContain("outline: none");
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
