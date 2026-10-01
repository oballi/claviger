import { z } from "zod";
import { base32Decode, base32Encode, normalizeBase32 } from "../encoding/base32";
import { CoreError } from "../errors";
import { registrableDomain } from "../match/domain";
import { OTP_ALGORITHMS, OTP_TYPES, type OtpAlgorithm, type OtpType } from "../otp/types";

export interface AccountInput {
  type: OtpType;
  secret: string;
  issuer: string;
  label: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
  domains: string[];
}

export interface Account extends AccountInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface AccountDraft {
  secret: string;
  type?: string;
  algorithm?: string;
  issuer?: string;
  label?: string;
  digits?: number;
  period?: number;
  counter?: number;
  domains?: string[];
}

export const accountSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["totp", "hotp", "steam"]),
  secret: z.string().min(1),
  issuer: z.string(),
  label: z.string(),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
  digits: z.number().int(),
  period: z.number().int(),
  counter: z.number().int(),
  domains: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const accountDraftSchema = z.object({
  secret: z.string(),
  type: z.string().optional(),
  algorithm: z.string().optional(),
  issuer: z.string().optional(),
  label: z.string().optional(),
  digits: z.number().optional(),
  period: z.number().optional(),
  counter: z.number().optional(),
  domains: z.array(z.string()).optional(),
});

const invalid = (message: string) => new CoreError("invalid-otp-params", message);

/** Replaces lone UTF-16 surrogates with U+FFFD; encodeURIComponent throws on them otherwise. */
const wellFormed = (s: string) =>
  s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�").trim();

function normalizeType(raw: string | undefined): OtpType {
  const type = (raw ?? "totp").toLowerCase();
  if (!(OTP_TYPES as readonly string[]).includes(type)) {
    throw new CoreError("unsupported-otp-type", `Unsupported OTP type: ${raw}`);
  }
  return type as OtpType;
}

function normalizeAlgorithm(raw: string | undefined): OtpAlgorithm {
  const algorithm = (raw ?? "SHA1").toUpperCase().replace(/-/g, "");
  if (!(OTP_ALGORITHMS as readonly string[]).includes(algorithm)) {
    throw new CoreError("unsupported-algorithm", `Unsupported algorithm: ${raw}`);
  }
  return algorithm as OtpAlgorithm;
}

function normalizeDomains(domains: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const d of domains ?? []) {
    const domain = registrableDomain(d);
    if (domain) out.add(domain);
  }
  return [...out].sort();
}

export function normalizeAccountInput(draft: AccountDraft): AccountInput {
  const type = normalizeType(draft.type);
  const secret = base32Encode(base32Decode(draft.secret));
  const issuer = wellFormed(draft.issuer ?? "");
  const label = wellFormed(draft.label ?? "");
  const domains = normalizeDomains(draft.domains);

  if (type === "steam") {
    return {
      type,
      secret,
      issuer: issuer || "Steam",
      label,
      algorithm: "SHA1",
      digits: 5,
      period: 30,
      counter: 0,
      domains,
    };
  }

  const algorithm = normalizeAlgorithm(draft.algorithm);
  const digits = draft.digits ?? 6;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8)
    throw invalid("Digits must be 6, 7 or 8");
  const period = draft.period ?? 30;
  if (!Number.isInteger(period) || period < 1 || period > 300)
    throw invalid("Period must be 1–300 seconds");
  const counter = draft.counter ?? 0;
  if (!Number.isSafeInteger(counter) || counter < 0)
    throw invalid("Counter must be a non-negative integer");

  return {
    type,
    secret,
    issuer,
    label,
    algorithm,
    digits,
    period: type === "totp" ? period : 30,
    counter: type === "hotp" ? counter : 0,
    domains,
  };
}

/** For duplicate detection: same type + same normalized secret = same account. */
export function accountFingerprint(a: { type: string; secret: string }): string {
  return `${a.type}:${normalizeBase32(a.secret)}`;
}
