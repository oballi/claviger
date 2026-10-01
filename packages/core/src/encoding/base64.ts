import { CoreError } from "../errors";

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Standart ve url-safe base64 kabul eder; padding ve boşluklar opsiyoneldir. */
export function fromBase64(text: string): Uint8Array {
  let clean = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new CoreError("invalid-base64", "Invalid base64 string");
  }
  clean = clean.replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new CoreError("invalid-base64", "Invalid base64 length");
  clean += "=".repeat((4 - (clean.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(clean);
  } catch (cause) {
    throw new CoreError("invalid-base64", "Invalid base64 string", { cause });
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
