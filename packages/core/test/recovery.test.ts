import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bytesEqual } from "../src/encoding/bytes";
import { webRandom } from "../src/ports";
import { encodeRecoveryCode, generateRecoveryCode, parseRecoveryCode } from "../src/vault/recovery";
import { codeOf } from "./helpers/errors";

describe("recovery codes", () => {
  it("formats 160 bits as 8 groups of 4 Crockford characters", () => {
    const { code, secret } = generateRecoveryCode(webRandom);
    expect(secret).toHaveLength(20);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  });

  it("encodes a known value", () => {
    expect(encodeRecoveryCode(new Uint8Array(20))).toBe("0000-0000-0000-0000-0000-0000-0000-0000");
    expect(encodeRecoveryCode(new Uint8Array(20).fill(255))).toBe(
      "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ",
    );
  });

  it("round-trips arbitrary secrets", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (secret) =>
        bytesEqual(parseRecoveryCode(encodeRecoveryCode(secret)), secret),
      ),
    );
  });

  it("tolerates lower case, spaces, missing hyphens and look-alike characters", () => {
    const { code, secret } = generateRecoveryCode(webRandom);
    const sloppy = ` ${code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l")} `;
    expect(bytesEqual(parseRecoveryCode(sloppy), secret)).toBe(true);
  });

  it.each([
    "",
    "ABCD-EFGH",
    "UUUU-0000-0000-0000-0000-0000-0000-0000",
    "0000-0000-0000-0000-0000-0000-0000-00000",
  ])("rejects %j", (input) => {
    expect(codeOf(() => parseRecoveryCode(input))).toBe("invalid-recovery-code");
  });

  it("refuses to encode a secret of the wrong size", () => {
    expect(codeOf(() => encodeRecoveryCode(new Uint8Array(16)))).toBe("invalid-recovery-code");
  });
});
