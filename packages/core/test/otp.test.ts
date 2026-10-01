import { describe, expect, it } from "vitest";
import { base32Encode } from "../src/encoding/base32";
import { utf8Encode } from "../src/encoding/bytes";
import { CLOCK_OFFSET_THRESHOLD_SEC, computeClockOffset } from "../src/otp/clock";
import { generateCode } from "../src/otp/generate";
import { counterBytes, hotp, hotpValue } from "../src/otp/hotp";
import { steam, steamFromValue } from "../src/otp/steam";
import { secondsRemaining, totp, totpCounter } from "../src/otp/totp";
import type { OtpAlgorithm } from "../src/otp/types";
import { codeOf } from "./helpers/errors";

// RFC 4226 Ek D
const RFC4226_SECRET = utf8Encode("12345678901234567890");
const HOTP_CODES = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];
const HOTP_TRUNCATED = [
  1284755224, 1094287082, 137359152, 1726969429, 1640338314, 868254676, 1918287922, 82162583,
  673399871, 645520489,
];

// RFC 6238 Ek B
const SEEDS: Record<OtpAlgorithm, Uint8Array> = {
  SHA1: utf8Encode("12345678901234567890"),
  SHA256: utf8Encode("12345678901234567890123456789012"),
  SHA512: utf8Encode("1234567890123456789012345678901234567890123456789012345678901234"),
};
const TOTP_VECTORS: [number, OtpAlgorithm, string][] = [
  [59, "SHA1", "94287082"],
  [59, "SHA256", "46119246"],
  [59, "SHA512", "90693936"],
  [1111111109, "SHA1", "07081804"],
  [1111111109, "SHA256", "68084774"],
  [1111111109, "SHA512", "25091201"],
  [1111111111, "SHA1", "14050471"],
  [1111111111, "SHA256", "67062674"],
  [1111111111, "SHA512", "99943326"],
  [1234567890, "SHA1", "89005924"],
  [1234567890, "SHA256", "91819424"],
  [1234567890, "SHA512", "93441116"],
  [2000000000, "SHA1", "69279037"],
  [2000000000, "SHA256", "90698825"],
  [2000000000, "SHA512", "38618901"],
  [20000000000, "SHA1", "65353130"],
  [20000000000, "SHA256", "77737706"],
  [20000000000, "SHA512", "47863826"],
];

describe("HOTP (RFC 4226)", () => {
  it.each(HOTP_CODES.map((code, counter) => [counter, code] as const))(
    "counter %i → %s",
    async (counter, code) => {
      expect(await hotp(RFC4226_SECRET, counter, { algorithm: "SHA1", digits: 6 })).toBe(code);
    },
  );

  it("matches the RFC truncated intermediate values", async () => {
    for (let counter = 0; counter < HOTP_TRUNCATED.length; counter++) {
      expect(await hotpValue(RFC4226_SECRET, counter, "SHA1")).toBe(HOTP_TRUNCATED[counter]);
    }
  });

  it("encodes large counters as 8-byte big-endian", () => {
    expect(Array.from(counterBytes(2 ** 40 + 5))).toEqual([0, 0, 1, 0, 0, 0, 0, 5]);
  });

  it("rejects negative or fractional counters", () => {
    expect(codeOf(() => counterBytes(-1))).toBe("invalid-otp-params");
    expect(codeOf(() => counterBytes(1.5))).toBe("invalid-otp-params");
  });
});

describe("TOTP (RFC 6238)", () => {
  it.each(TOTP_VECTORS)("t=%i %s → %s", async (t, algorithm, code) => {
    expect(await totp(SEEDS[algorithm], t * 1000, { algorithm, digits: 8, period: 30 })).toBe(code);
  });

  it("uses floor, so the code changes exactly at the period boundary", () => {
    expect(totpCounter(29_500, 30)).toBe(0);
    expect(totpCounter(29_999, 30)).toBe(0);
    expect(totpCounter(30_000, 30)).toBe(1);
  });

  it("applies the clock offset in seconds", () => {
    expect(totpCounter(0, 30, 30)).toBe(1);
    expect(totpCounter(30_000, 30, -1)).toBe(0);
  });

  it("reports seconds remaining in the current period", () => {
    expect(secondsRemaining(0, 30)).toBe(30);
    expect(secondsRemaining(29_999, 30)).toBe(1);
    expect(secondsRemaining(30_000, 30)).toBe(30);
    expect(secondsRemaining(0, 30, 10)).toBe(20);
  });
});

describe("Steam", () => {
  it("maps a truncated value to the Steam alphabet", () => {
    expect(steamFromValue(1284755224)).toBe("GG5F5");
  });

  it("uses HMAC-SHA1 with a 30 s period", async () => {
    expect(await steam(RFC4226_SECRET, 10_000)).toBe("GG5F5");
  });
});

describe("generateCode", () => {
  const secret = base32Encode(SEEDS.SHA1);

  it("generates TOTP with remaining seconds", async () => {
    const result = await generateCode(
      { type: "totp", secret, algorithm: "SHA1", digits: 8, period: 30, counter: 0 },
      59_000,
    );
    expect(result).toEqual({ code: "94287082", remaining: 1, period: 30 });
  });

  it("generates HOTP from the stored counter", async () => {
    const result = await generateCode(
      { type: "hotp", secret, algorithm: "SHA1", digits: 6, period: 30, counter: 1 },
      0,
    );
    expect(result).toEqual({ code: "287082", remaining: null, period: null });
  });

  it("generates Steam codes", async () => {
    const result = await generateCode(
      { type: "steam", secret, algorithm: "SHA1", digits: 5, period: 30, counter: 0 },
      10_000,
    );
    expect(result).toEqual({ code: "GG5F5", remaining: 20, period: 30 });
  });
});

describe("clock offset", () => {
  it("compares the server Date header to the request midpoint", () => {
    expect(computeClockOffset("Thu, 01 Jan 1970 00:01:40 GMT", 40_000, 60_000)).toBe(50);
  });

  it("returns null for an unparsable header", () => {
    expect(computeClockOffset("not a date", 0, 0)).toBeNull();
  });

  it("exposes the spec threshold", () => {
    expect(CLOCK_OFFSET_THRESHOLD_SEC).toBe(30);
  });
});
