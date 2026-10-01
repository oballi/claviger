import { hotp } from "./hotp";
import type { OtpAlgorithm } from "./types";

export function totpCounter(nowMs: number, period: number, offsetSec = 0): number {
  return Math.floor((Math.floor(nowMs / 1000) + offsetSec) / period);
}

export function secondsRemaining(nowMs: number, period: number, offsetSec = 0): number {
  const seconds = Math.floor(nowMs / 1000) + offsetSec;
  return period - (((seconds % period) + period) % period);
}

export async function totp(
  secret: Uint8Array,
  nowMs: number,
  opts: { algorithm: OtpAlgorithm; digits: number; period: number; offsetSec?: number },
): Promise<string> {
  return hotp(secret, totpCounter(nowMs, opts.period, opts.offsetSec ?? 0), opts);
}
