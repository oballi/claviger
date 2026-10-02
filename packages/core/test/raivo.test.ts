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

  it("accepts only totp/hotp kinds; STEAM and MOTP are unsupported-type", async () => {
    const steam = { ...RAIVO_ENTRIES[0], kind: "STEAM", secret: "MFRGG" };
    const out = await parseImport(JSON.stringify([steam, RAIVO_ENTRIES[0]]));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toHaveLength(1);
    expect(out.result.issues).toMatchObject([{ position: 0, reason: "unsupported-type" }]);
  });

  it("numeric fields: real numbers and digit strings pass, lenient strings do not", async () => {
    const base = RAIVO_ENTRIES[0]!;
    const entries = [
      { ...base, digits: 8, timer: 60 },
      { ...base, digits: " 6" },
      { ...base, digits: "6abc" },
      { ...base, timer: "0x1e" },
      { ...base, counter: "-1" },
      { ...base, digits: "1e1" },
    ];
    const out = await parseImport(JSON.stringify(entries));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toMatchObject([{ digits: 8, period: 60 }]);
    expect(out.result.issues.map((i) => [i.position, i.reason])).toEqual([
      [1, "invalid-params"],
      [2, "invalid-params"],
      [3, "invalid-params"],
      [4, "invalid-params"],
      [5, "invalid-params"],
    ]);
  });
});
