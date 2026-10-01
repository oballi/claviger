import { CoreError } from "../errors";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(
  bytes: Uint8Array,
  { padding = false }: { padding?: boolean } = {},
): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  if (padding) while (out.length % 8 !== 0) out += "=";
  return out;
}

export function normalizeBase32(input: string): string {
  return input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

export function base32Decode(input: string): Uint8Array {
  const clean = normalizeBase32(input);
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = ALPHABET.indexOf(ch);
    if (value === -1) throw new CoreError("invalid-base32", "Invalid base32 character");
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length === 0)
    throw new CoreError("invalid-base32", "Base32 string is empty or too short");
  return Uint8Array.from(out);
}
