import { base32Decode } from "../encoding/base32";
import { hotp } from "./hotp";
import { steam } from "./steam";
import { secondsRemaining, totp } from "./totp";
import type { OtpAlgorithm, OtpType } from "./types";

export interface OtpParams {
  type: OtpType;
  /** Normalize edilmiş base32 */
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
}

export interface GeneratedCode {
  code: string;
  /** Kodun değişmesine kalan saniye; HOTP için null */
  remaining: number | null;
  period: number | null;
}

export async function generateCode(
  p: OtpParams,
  nowMs: number,
  offsetSec = 0,
): Promise<GeneratedCode> {
  const key = base32Decode(p.secret);
  switch (p.type) {
    case "hotp":
      return { code: await hotp(key, p.counter, p), remaining: null, period: null };
    case "steam":
      return {
        code: await steam(key, nowMs, offsetSec),
        remaining: secondsRemaining(nowMs, 30, offsetSec),
        period: 30,
      };
    case "totp":
      return {
        code: await totp(key, nowMs, {
          algorithm: p.algorithm,
          digits: p.digits,
          period: p.period,
          offsetSec,
        }),
        remaining: secondsRemaining(nowMs, p.period, offsetSec),
        period: p.period,
      };
  }
}
