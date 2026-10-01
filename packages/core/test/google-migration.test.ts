import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base32Encode } from "../src/encoding/base32";
import { isCoreError } from "../src/errors";
import { parseGoogleMigrationUri } from "../src/importers/googleMigration";
import { codeOf } from "./helpers/errors";
import { migrationPayload, migrationUri, otpParameters } from "./helpers/protobuf";

// Herkese açık bir Google Authenticator export örneği (secret "Hello!\xde\xad\xbe\xef").
const PUBLIC_SAMPLE =
  "otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZSABKAEwAhABGAEgACjr4JKK%2Bv%2F%2F%2F%2F8B";

describe("parseGoogleMigrationUri", () => {
  it("parses a real-world export", () => {
    const result = parseGoogleMigrationUri(PUBLIC_SAMPLE);
    expect(result.issues).toEqual([]);
    expect(result.accounts).toEqual([
      {
        type: "totp",
        secret: "JBSWY3DPEHPK3PXP",
        issuer: "Example",
        label: "alice@google.com",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        counter: 0,
        domains: [],
      },
    ]);
    expect(result.batch).toMatchObject({ size: 1, index: 0 });
  });

  it("handles long fields, UTF-8, HOTP counters above 127 and SHA256/8 digits (upstream #1292)", () => {
    const secret = new Uint8Array(20).fill(7);
    const longName = "a".repeat(200);
    const result = parseGoogleMigrationUri(
      migrationUri(
        migrationPayload([
          otpParameters({
            secret,
            name: longName,
            issuer: "Ömer Ltd",
            algorithm: 2,
            digits: 2,
            type: 2,
          }),
          otpParameters({
            secret: new Uint8Array(10).fill(1),
            name: "Bank:me",
            issuer: "Bank",
            type: 1,
            counter: 300,
          }),
        ]),
      ),
    );
    expect(result.issues).toEqual([]);
    expect(result.accounts[0]).toMatchObject({
      secret: base32Encode(secret),
      label: longName,
      issuer: "Ömer Ltd",
      algorithm: "SHA256",
      digits: 8,
    });
    expect(result.accounts[1]).toMatchObject({
      type: "hotp",
      counter: 300,
      issuer: "Bank",
      label: "me",
    });
  });

  it("splits 'Issuer:name' when the issuer field is empty", () => {
    const result = parseGoogleMigrationUri(
      migrationUri(
        migrationPayload([otpParameters({ secret: new Uint8Array(10), name: "GitHub:me" })]),
      ),
    );
    expect(result.accounts[0]).toMatchObject({ issuer: "GitHub", label: "me" });
  });

  it("reports unsupported or broken entries but keeps the rest", () => {
    const ok = otpParameters({ secret: new Uint8Array(10).fill(3), name: "ok" });
    const md5 = otpParameters({ secret: new Uint8Array(10).fill(4), name: "md5", algorithm: 4 });
    const empty = otpParameters({ secret: new Uint8Array(), name: "empty" });
    const badUtf8 = otpParameters({
      secret: new Uint8Array(10).fill(5),
      name: Uint8Array.of(0xc3, 0x28),
    });
    const unknownType = otpParameters({
      secret: new Uint8Array(10).fill(6),
      name: "weird",
      type: 9,
    });
    const result = parseGoogleMigrationUri(
      migrationUri(migrationPayload([ok, md5, empty, badUtf8, unknownType])),
    );
    expect(result.accounts.map((a) => a.label)).toEqual(["ok"]);
    expect(result.issues.map((i) => [i.position, i.reason])).toEqual([
      [1, "unsupported-algorithm"],
      [2, "invalid-secret"],
      [3, "malformed-entry"],
      [4, "unsupported-type"],
    ]);
  });

  it("accepts a raw '+' or '/' in the data parameter", () => {
    for (let fill = 0; fill < 256; fill++) {
      const payload = migrationPayload([
        otpParameters({ secret: new Uint8Array(10).fill(fill), name: "x" }),
      ]);
      const b64 = Buffer.from(payload).toString("base64");
      if (!/[+/]/.test(b64)) continue;
      const raw = parseGoogleMigrationUri(migrationUri(payload, { percentEncode: false }));
      expect(raw).toEqual(parseGoogleMigrationUri(migrationUri(payload)));
      return;
    }
    throw new Error("no payload with '+' or '/' found");
  });

  it.each([
    ["https://example.com", "invalid-uri"],
    ["otpauth-migration://offline?foo=bar", "invalid-uri"],
    ["otpauth-migration://offline?data=%%%", "invalid-uri"],
    ["otpauth-migration://offline?data=ChAB", "invalid-protobuf"],
  ])("rejects %s with %s", (uri, code) => {
    expect(codeOf(() => parseGoogleMigrationUri(uri))).toBe(code);
  });

  it("never throws anything but CoreError on random payloads", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        try {
          parseGoogleMigrationUri(migrationUri(bytes));
        } catch (e) {
          return isCoreError(e);
        }
        return true;
      }),
    );
  });
});
