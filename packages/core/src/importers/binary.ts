import { fromBase64, toBase64 } from "../encoding/base64";

export const BINARY_PREFIX = "claviger-binary:";
// importPreview text is capped at 5 000 000 chars; base64 inflates by 4/3.
const MAX_BINARY_BYTES = 3_700_000;

export const encodeBinaryImport = (bytes: Uint8Array): string => BINARY_PREFIX + toBase64(bytes);

/** null for missing prefix, invalid base64 or an oversized body (callers decide what that means). */
export function decodeBinaryImport(text: string): Uint8Array | null {
  if (!text.startsWith(BINARY_PREFIX)) return null;
  const body = text.slice(BINARY_PREFIX.length).trim();
  // Reject before decoding: base64 of the cap is at most 4/3 of it.
  if (body.length > Math.ceil((MAX_BINARY_BYTES * 4) / 3) + 4) return null;
  try {
    const bytes = fromBase64(body);
    return bytes.length <= MAX_BINARY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}
