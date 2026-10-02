import { isClavigerExport, parseClavigerExport } from "../exporters/claviger";
import { isAndotpEncrypted, isAndotpPlain, parseAndotpEncrypted, parseAndotpPlain } from "./andotp";
import { aegisNeedsPassword, isAegisFile, parseAegis } from "./aegis";
import { isBitwardenFile, parseBitwarden } from "./bitwarden";
import { BINARY_PREFIX, decodeBinaryImport } from "./binary";
import { isFreeotpPlus, parseFreeotpPlus } from "./freeotpPlus";
import { CoreError } from "../errors";
import { parseOtpauthText } from "./otpauthText";
import { isProtonFile, parseProton, protonNeedsPassword } from "./proton";
import { isTwofasFile, parseTwofas, twofasNeedsPassword } from "./twofas";
import type { ImportResult } from "./types";
import { isUpstreamBackup, parseUpstreamBackup, upstreamNeedsPassword } from "./upstream";

export type ImportFormat =
  | "otpauth"
  | "google-migration"
  | "upstream-authenticator"
  | "aegis"
  | "2fas"
  | "claviger"
  | "proton-authenticator"
  | "bitwarden"
  | "andotp"
  | "freeotp-plus";

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
    format: "claviger",
    detect: isClavigerExport,
    needsPassword: () => true,
    parse: (j, p) => parseClavigerExport(j, p ?? ""),
  },
  { format: "aegis", detect: isAegisFile, needsPassword: aegisNeedsPassword, parse: parseAegis },
  { format: "2fas", detect: isTwofasFile, needsPassword: twofasNeedsPassword, parse: parseTwofas },
  {
    format: "proton-authenticator",
    detect: isProtonFile,
    needsPassword: protonNeedsPassword,
    parse: parseProton,
  },
  {
    format: "bitwarden",
    detect: isBitwardenFile,
    needsPassword: () => false,
    parse: (j) => parseBitwarden(j),
  },
  {
    format: "freeotp-plus",
    detect: isFreeotpPlus,
    needsPassword: () => false,
    parse: (j) => Promise.resolve(parseFreeotpPlus(j)),
  },
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

  if (trimmed.startsWith(BINARY_PREFIX)) return parseBinary(trimmed, password);

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { status: "unrecognized" };
  }

  // Root arrays: andOTP first (Raivo joins later, after the andOTP check).
  if (Array.isArray(json)) {
    if (!isAndotpPlain(json)) return { status: "unrecognized" };
    return { status: "ok", format: "andotp", result: parseAndotpPlain(json) };
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

const MIN_ENCRYPTED_LENGTH = 4 + 12 + 12 + 16;

async function parseBinary(text: string, password?: string): Promise<ImportParseOutcome> {
  const bytes = decodeBinaryImport(text);
  if (!bytes) throw new CoreError("corrupt-file", "Binary import is invalid or too large");
  // The UI only sends non-UTF-8 files this way, but a text payload still works.
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Only plausible text formats; NUL-heavy binary headers are valid UTF-8 too.
    if (/^\s*(\[|\{|otpauth)/i.test(decoded)) return parseImport(decoded, password);
  } catch {
    // Not text: fall through to the binary formats.
  }
  if (bytes.length < MIN_ENCRYPTED_LENGTH) return { status: "unrecognized" };
  if (!isAndotpEncrypted(bytes))
    throw new CoreError("corrupt-file", "Unsupported binary backup parameters");
  if (!password) return { status: "needs-password", format: "andotp" };
  return {
    status: "ok",
    format: "andotp",
    result: await parseAndotpEncrypted(bytes, password),
  };
}
