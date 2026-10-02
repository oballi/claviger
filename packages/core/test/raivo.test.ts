import { describe, expect, it } from "vitest";
import { parseImport } from "../src/importers";
import { asyncCodeOf } from "./helpers/errors";
import { RAIVO_ENTRIES } from "./helpers/raivo";

describe("Raivo import", () => {
  it("reads string-typed fields and reports unsupported kinds", async () => {
    const out = await parseImport(JSON.stringify(RAIVO_ENTRIES));
    expect(out).toMatchObject({ status: "ok", format: "raivo" });
    if (out.status !== "ok") return;
    expect(out.result.accounts.map((a) => [a.type, a.issuer, a.label, a.algorithm])).toEqual([
      ["totp", "Deno", "Mason", "SHA1"],
      ["hotp", "Issuu", "James", "SHA256"],
    ]);
    expect(out.result.accounts[1]).toMatchObject({ digits: 8, counter: 4 });
    expect(out.result.issues).toMatchObject([{ position: 2, reason: "unsupported-type" }]);
  });

  it("flags non-numeric digits and malformed entries", async () => {
    const out = await parseImport(
      JSON.stringify([RAIVO_ENTRIES[0], { ...RAIVO_ENTRIES[0], digits: "abc" }, { kind: "TOTP" }]),
    );
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toHaveLength(1);
    expect(out.result.issues.map((i) => i.reason)).toEqual(["invalid-params", "malformed-entry"]);
  });

  it("does not claim arbitrary arrays and caps the entry count", async () => {
    expect(await parseImport("[1,2]")).toEqual({ status: "unrecognized" });
    const many = Array.from({ length: 10_001 }, () => RAIVO_ENTRIES[0]);
    expect(await asyncCodeOf(parseImport(JSON.stringify(many)))).toBe("unsupported-format");
  });

  it("detects from a bounded sample", async () => {
    const big: unknown[] = Array.from({ length: 200_000 }, () => 1);
    big.push(RAIVO_ENTRIES[0]);
    expect(await parseImport(JSON.stringify(big))).toEqual({ status: "unrecognized" });
  });
});
