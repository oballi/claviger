import { base32Encode } from "../../src/encoding/base32";

// Synthetic secrets only; bytes >= 0x80 on purpose to exercise Java signed bytes.
const SECRET_A = Buffer.from("1f8b2c9dfeaa00ff7e3c5a80", "hex");
const SECRET_B = Buffer.from("a1b2c3d4e5f60718293a4b5c6d7e8f90", "hex");

export const signed = (buf: Uint8Array): number[] => Array.from(buf, (b) => (b << 24) >> 24);
export const FREEOTP_SECRETS = { a: base32Encode(SECRET_A), b: base32Encode(SECRET_B) };

export function freeotpPlus(): { tokens: unknown[]; tokenOrder: string[] } {
  return {
    tokens: [
      {
        algo: "SHA1",
        counter: 0,
        digits: 6,
        issuerExt: "Deno",
        issuerInt: "deno-int",
        label: "Mason",
        period: 30,
        secret: signed(SECRET_A),
        type: "TOTP",
      },
      {
        algo: "SHA256",
        counter: 5,
        digits: 8,
        issuerExt: "",
        issuerInt: "Internal",
        label: "James",
        period: 30,
        secret: signed(SECRET_B),
        type: "HOTP",
      },
      {
        algo: "SHA1",
        counter: 0,
        digits: 5,
        issuerExt: "Steam",
        issuerInt: "Steam",
        label: "Sophia",
        period: 30,
        secret: signed(SECRET_A),
        type: "TOTP",
      },
    ],
    tokenOrder: [],
  };
}
