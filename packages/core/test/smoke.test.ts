import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "../src/index";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

describe("core", () => {
  it("exposes the package version", () => {
    expect(CORE_VERSION).toBe(pkg.version);
  });
});
