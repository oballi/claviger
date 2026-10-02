// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CountdownRing } from "@claviger/ui";

// jsdom rewrites import.meta.url, so resolve from the package root vitest runs in.
const css = readFileSync(resolve(process.cwd(), "../../packages/ui/src/styles.css"), "utf8");

afterEach(cleanup);

const ring = (remaining: number) => {
  const { container } = render(<CountdownRing remaining={remaining} period={30} />);
  const svg = container.querySelector("svg")!;
  return { svg, stroke: svg.querySelectorAll("circle")[1]!.getAttribute("stroke") };
};

describe("countdown colours", () => {
  it("is muted, then warn in the last 5 s, then critical in the last second", () => {
    expect(ring(12).stroke).toBe("var(--ov-muted)");
    expect(ring(5).stroke).toBe("var(--ov-warn)");
    expect(ring(2).svg.dataset.critical).toBe("false");
    const last = ring(1);
    expect(last.stroke).toBe("var(--ov-critical)");
    expect(last.svg.dataset.critical).toBe("true");
  });

  it("defines the critical red for light and both dark token blocks", () => {
    expect(css.match(/--ov-critical: #b3261e;/g)).toHaveLength(1);
    expect(css.match(/--ov-critical: #e5736b;/g)).toHaveLength(2);
    expect(css).toContain("--color-critical: var(--ov-critical);");
  });
});
