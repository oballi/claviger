const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8Encode(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Geçersiz UTF-8 dizilerinde TypeError fırlatır. */
export function utf8Decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** WebCrypto tipleri Uint8Array<ArrayBufferLike> kabul etmez; bağımsız bir ArrayBuffer kopyası üretir. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
