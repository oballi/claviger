import { isOtpvaultExport, parseOtpvaultExport } from "../exporters/otpvault";
import { aegisNeedsPassword, isAegisFile, parseAegis } from "./aegis";
import { parseOtpauthText } from "./otpauthText";
import { isTwofasFile, parseTwofas, twofasNeedsPassword } from "./twofas";
import type { ImportResult } from "./types";
import { isUpstreamBackup, parseUpstreamBackup, upstreamNeedsPassword } from "./upstream";

export type ImportFormat =
  "otpauth" | "google-migration" | "upstream-authenticator" | "aegis" | "2fas" | "otp-vault";

export type ImportParseOutcome =
  | { status: "ok"; format: ImportFormat; result: ImportResult }
  | { status: "needs-password"; format: ImportFormat }
  | { status: "unrecognized" };

interface JsonFormat {
  format: ImportFormat;
  detect(json: unknown): boolean;
  needsPassword(json: unknown): boolean;
  parse(json: unknown, password?: string): Promise<ImportResult>;
}

// Order matters: the format with the most distinctive signature is tried first; upstream detection is the loosest, so it goes last.
const JSON_FORMATS: JsonFormat[] = [
  {
    format: "otp-vault",
    detect: isOtpvaultExport,
    needsPassword: () => true,
    parse: (j, p) => parseOtpvaultExport(j, p ?? ""),
  },
  { format: "aegis", detect: isAegisFile, needsPassword: aegisNeedsPassword, parse: parseAegis },
  { format: "2fas", detect: isTwofasFile, needsPassword: twofasNeedsPassword, parse: parseTwofas },
  {
    format: "upstream-authenticator",
    detect: isUpstreamBackup,
    needsPassword: upstreamNeedsPassword,
    parse: parseUpstreamBackup,
  },
];

export async function parseImport(text: string, password?: string): Promise<ImportParseOutcome> {
  const trimmed = text.trim();
  if (/^otpauth(-migration)?:/i.test(trimmed)) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const format: ImportFormat = lines.every((l) => /^otpauth-migration:/i.test(l))
      ? "google-migration"
      : "otpauth";
    return { status: "ok", format, result: parseOtpauthText(trimmed) };
  }

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { status: "unrecognized" };
  }

  for (const candidate of JSON_FORMATS) {
    if (!candidate.detect(json)) continue;
    if (candidate.needsPassword(json) && !password)
      return { status: "needs-password", format: candidate.format };
    return {
      status: "ok",
      format: candidate.format,
      result: await candidate.parse(json, password),
    };
  }
  return { status: "unrecognized" };
}
