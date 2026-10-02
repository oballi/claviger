import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { base32Encode } from "../src/encoding/base32";
import { parseOtpauthUri, toOtpauthUri } from "../src/uri/otpauth";
import { codeOf } from "./helpers/errors";

describe("parseOtpauthUri", () => {
  it("parses the Google Key URI example", () => {
    expect(
      parseOtpauthUri(
        "otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
      ),
    ).toEqual({
      type: "totp",
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "Example",
      label: "alice@google.com",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      counter: 0,
      domains: [],
    });
  });

  it("decodes percent-encoding and '+' in parameters", () => {
    const a = parseOtpauthUri(
      "otpauth://totp/ACME%20Co:john.doe%40email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME+Co&algorithm=SHA256&digits=8&period=60",
    );
    expect(a).toMatchObject({
      issuer: "ACME Co",
      label: "john.doe@email.com",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
  });

  it("prefers the issuer parameter over the label prefix", () => {
    expect(parseOtpauthUri("otpauth://totp/Old:me?secret=JBSWY3DPEHPK3PXP&issuer=New").issuer).toBe(
      "New",
    );
  });

  it("uses the label prefix when the issuer parameter is missing or empty", () => {
    expect(parseOtpauthUri("otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP")).toMatchObject({
      issuer: "GitHub",
      label: "me",
    });
    expect(
      parseOtpauthUri("otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP&issuer="),
    ).toMatchObject({ issuer: "GitHub", label: "me" });
  });

  it("is case-insensitive for scheme, type and parameter names; tolerates lower-case secrets", () => {
    expect(parseOtpauthUri("OTPAUTH://TOTP/x?SECRET=jbswy3dpehpk3pxp&Digits=7")).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      digits: 7,
    });
  });

  it("reads HOTP counters", () => {
    expect(parseOtpauthUri("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=300")).toMatchObject({
      type: "hotp",
      counter: 300,
    });
  });

  it("recognizes Steam via type or encoder", () => {
    expect(parseOtpauthUri("otpauth://steam/me?secret=JBSWY3DPEHPK3PXP").type).toBe("steam");
    expect(
      parseOtpauthUri("otpauth://totp/Steam:me?secret=JBSWY3DPEHPK3PXP&encoder=steam").type,
    ).toBe("steam");
  });

  it("keeps a malformed percent sequence as raw text", () => {
    expect(parseOtpauthUri("otpauth://totp/50%25%ZZ?secret=JBSWY3DPEHPK3PXP").label).toBe(
      "50%25%ZZ",
    );
  });

  it.each([
    ["https://example.com", "invalid-uri"],
    ["otpauth://totp/x?issuer=a", "invalid-uri"],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=abc", "invalid-uri"],
    ["otpauth://motp/x?secret=JBSWY3DPEHPK3PXP", "unsupported-otp-type"],
    ["otpauth://totp/x?secret=not-base32!", "invalid-base32"],
    ["otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5", "unsupported-algorithm"],
  ])("rejects %s with %s", (uri, code) => {
    expect(codeOf(() => parseOtpauthUri(uri))).toBe(code);
  });
});

describe("toOtpauthUri", () => {
  it("writes Steam with the steam host and round-trips", () => {
    const steam = normalizeAccountInput({
      type: "steam",
      secret: "JRZCL47CMXVOQMNPZR2F7J4RGI",
      issuer: "Steam",
      label: "gaben",
    });
    const uri = toOtpauthUri(steam);
    expect(uri.startsWith("otpauth://steam/")).toBe(true);
    expect(parseOtpauthUri(uri)).toEqual(steam);
  });

  it("round-trips through parseOtpauthUri", () => {
    const text = fc.string({ maxLength: 20 }).map((s) => s.trim());
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 10, maxLength: 32 }),
        fc.constantFrom("totp", "hotp", "steam"),
        text,
        text.filter((s) => !s.includes(":")),
        fc.constantFrom("SHA1", "SHA256", "SHA512"),
        fc.integer({ min: 6, max: 8 }),
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (secret, type, issuer, label, algorithm, digits, period, counter) => {
          const input = normalizeAccountInput({
            secret: base32Encode(secret),
            type,
            issuer,
            label,
            algorithm,
            digits,
            period,
            counter,
          });
          expect(parseOtpauthUri(toOtpauthUri(input))).toEqual(input);
        },
      ),
    );
  });
});
