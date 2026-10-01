import { CoreError } from "../errors";
import type { RandomPort } from "../ports";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_BYTES = 20;

const invalid = (message: string) => new CoreError("invalid-recovery-code", message);

export function encodeRecoveryCode(secret: Uint8Array): string {
  if (secret.length !== RECOVERY_BYTES)
    throw invalid(`Recovery secret must be ${RECOVERY_BYTES} bytes`);
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of secret) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

export function generateRecoveryCode(random: RandomPort): { code: string; secret: Uint8Array } {
  const secret = random.bytes(RECOVERY_BYTES);
  return { code: encodeRecoveryCode(secret), secret };
}

export function parseRecoveryCode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length !== 32) throw invalid("Recovery code must have 32 characters");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = CROCKFORD.indexOf(ch);
    if (value === -1) throw invalid("Invalid character in recovery code");
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
