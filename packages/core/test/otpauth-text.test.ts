import { describe, expect, it } from "vitest";
import { parseOtpauthText } from "../src/importers/otpauthText";
import { migrationPayload, migrationUri, otpParameters } from "./helpers/protobuf";

describe("parseOtpauthText", () => {
  it("parses one URI per line, ignoring blank lines and CRLF", () => {
    const text = [
      "otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP",
      "",
      "otpauth://hotp/Bank:me?secret=GEZDGNBVGY3TQOJQ&counter=3\r",
    ].join("\n");
    const result = parseOtpauthText(text);
    expect(result.accounts.map((a) => [a.issuer, a.type])).toEqual([
      ["GitHub", "totp"],
      ["Bank", "hotp"],
    ]);
    expect(result.issues).toEqual([]);
  });

  it("expands migration lines and keeps running positions", () => {
    const migration = migrationUri(
      migrationPayload([
        otpParameters({ secret: new Uint8Array(10).fill(1), name: "a" }),
        otpParameters({ secret: new Uint8Array(10).fill(2), name: "b", algorithm: 4 }),
      ]),
    );
    const result = parseOtpauthText(
      `otpauth://totp/x?secret=JBSWY3DPEHPK3PXP\n${migration}\nhello world`,
    );
    expect(result.accounts.map((a) => a.label)).toEqual(["x", "a"]);
    expect(result.issues.map((i) => [i.position, i.reason])).toEqual([
      [2, "unsupported-algorithm"],
      [3, "malformed-entry"],
    ]);
  });

  it("names failed lines by label without leaking the secret", () => {
    const result = parseOtpauthText("otpauth://totp/Shop:me?secret=NOT*BASE32");
    expect(result.issues).toEqual([
      expect.objectContaining({ position: 0, name: "Shop:me", reason: "invalid-secret" }),
    ]);
    expect(JSON.stringify(result.issues)).not.toContain("NOT*BASE32");
  });

  it("reports a broken migration line as one malformed entry", () => {
    const result = parseOtpauthText("otpauth-migration://offline?data=ChAB");
    expect(result.issues).toEqual([
      expect.objectContaining({ position: 0, reason: "malformed-entry" }),
    ]);
  });
});
