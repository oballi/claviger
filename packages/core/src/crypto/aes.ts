import { fromBase64, toBase64 } from "../encoding/base64";
import { toArrayBuffer, utf8Encode } from "../encoding/bytes";
import type { RandomPort } from "../ports";

export interface Sealed {
  iv: string;
  ct: string;
}

/** AES-256-GCM decrypt. `data` = ciphertext||tag. Returns null if authentication fails. */
export async function gcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, [
      "decrypt",
    ]);
    const params: AesGcmParams = { name: "AES-GCM", iv: toArrayBuffer(iv) };
    if (aad) params.additionalData = toArrayBuffer(aad);
    return new Uint8Array(await crypto.subtle.decrypt(params, cryptoKey, toArrayBuffer(data)));
  } catch {
    return null;
  }
}

export async function sealBytes(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: string,
  random: RandomPort,
): Promise<Sealed> {
  const iv = random.bytes(12);
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, [
    "encrypt",
  ]);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(utf8Encode(aad)) },
    cryptoKey,
    toArrayBuffer(plaintext),
  );
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function openBytes(
  key: Uint8Array,
  sealed: Sealed,
  aad: string,
): Promise<Uint8Array | null> {
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    iv = fromBase64(sealed.iv);
    ct = fromBase64(sealed.ct);
  } catch {
    return null;
  }
  return gcmDecrypt(key, iv, ct, utf8Encode(aad));
}
