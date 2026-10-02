import type { AccountInput } from "../account/account";
import { base32Decode } from "../encoding/base32";
import { toBase64 } from "../encoding/base64";
import { concatBytes, utf8Encode } from "../encoding/bytes";
import { fieldBytes, fieldVarint } from "../encoding/protobuf";

export interface MigrationSkip {
  id?: string;
  name: string;
  reason: "digits-unsupported" | "period-unsupported" | "type-unsupported" | "too-long";
}

export interface MigrationOptions {
  maxPerQr?: number;
  maxUriChars?: number;
  batchId?: number;
}

const ALGO = { SHA1: 1, SHA256: 2, SHA512: 3 } as const;
const PREFIX = "otpauth-migration://offline?data=";
// Conservative varint widths for batch_size/batch_index; real values only get shorter.
const PLACEHOLDER = 16383;

function otpParameters(a: AccountInput): Uint8Array {
  return concatBytes(
    fieldBytes(1, base32Decode(a.secret)),
    fieldBytes(2, utf8Encode(a.label)),
    fieldBytes(3, utf8Encode(a.issuer)),
    fieldVarint(4, ALGO[a.algorithm]),
    fieldVarint(5, a.digits === 8 ? 2 : 1),
    fieldVarint(6, a.type === "hotp" ? 1 : 2),
    ...(a.type === "hotp" ? [fieldVarint(7, a.counter)] : []),
  );
}

function toUri(entries: Uint8Array[], size: number, index: number, batchId: number): string {
  const payload = concatBytes(
    ...entries.map((e) => fieldBytes(1, e)),
    fieldVarint(2, 1),
    fieldVarint(3, size),
    fieldVarint(4, index),
    fieldVarint(5, batchId),
  );
  return PREFIX + encodeURIComponent(toBase64(payload));
}

function skipReason(a: AccountInput): MigrationSkip["reason"] | null {
  if (a.type !== "totp" && a.type !== "hotp") return "type-unsupported";
  if (a.digits !== 6 && a.digits !== 8) return "digits-unsupported";
  if (a.type === "totp" && a.period !== 30) return "period-unsupported";
  return null;
}

function defaultBatchId(): number {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return bytes[0]! & 0x7fffffff || 1;
}

/** Google Authenticator transfer QRs. Anything the format cannot carry is listed in `skipped`, never dropped. */
export function buildMigrationUris(
  accounts: (AccountInput & { id?: string })[],
  opts: MigrationOptions = {},
): { uris: string[]; skipped: MigrationSkip[] } {
  const maxPerQr = opts.maxPerQr ?? 8;
  const maxUriChars = opts.maxUriChars ?? 600;
  const batchId = opts.batchId ?? defaultBatchId();
  const skipped: MigrationSkip[] = [];
  const batches: Uint8Array[][] = [];
  let current: Uint8Array[] = [];

  const measure = (entries: Uint8Array[]) =>
    toUri(entries, PLACEHOLDER, PLACEHOLDER, batchId).length;

  for (const a of accounts) {
    const skip = (reason: MigrationSkip["reason"]) =>
      skipped.push({
        ...(a.id !== undefined && { id: a.id }),
        name: a.issuer ? `${a.issuer}: ${a.label}` : a.label,
        reason,
      });
    const reason = skipReason(a);
    if (reason) {
      skip(reason);
      continue;
    }
    const entry = otpParameters(a);
    if (measure([entry]) > maxUriChars) {
      skip("too-long");
      continue;
    }
    if (current.length >= maxPerQr || measure([...current, entry]) > maxUriChars) {
      batches.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) batches.push(current);

  return {
    uris: batches.map((entries, i) => toUri(entries, batches.length, i, batchId)),
    skipped,
  };
}
