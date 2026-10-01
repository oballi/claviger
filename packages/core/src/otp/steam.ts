import { hotpValue } from "./hotp";
import { totpCounter } from "./totp";

const STEAM_ALPHABET = "23456789BCDFGHJKMNPQRTVWXY";

export function steamFromValue(value: number): string {
  let rest = value;
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += STEAM_ALPHABET[rest % STEAM_ALPHABET.length];
    rest = Math.floor(rest / STEAM_ALPHABET.length);
  }
  return out;
}

export async function steam(secret: Uint8Array, nowMs: number, offsetSec = 0): Promise<string> {
  return steamFromValue(await hotpValue(secret, totpCounter(nowMs, 30, offsetSec), "SHA1"));
}
