// Synthetic secrets only, never real accounts.
export const ANDOTP_ENTRIES = [
  {
    type: "TOTP",
    secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ",
    issuer: "Deno",
    label: "Mason",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    tags: ["Work"],
    thumbnail: "Default",
    last_used: 0,
  },
  {
    type: "HOTP",
    secret: "YOOMIXWS5GN6RTBPUFFWKTW5M4",
    issuer: "Issuu",
    label: "James",
    algorithm: "SHA1",
    digits: 6,
    counter: 7,
    tags: [],
  },
  {
    type: "STEAM",
    secret: "JRZCL47CMXVOQMNPZR2F7J4RGI",
    issuer: "Steam",
    label: "Sophia",
    algorithm: "SHA1",
    digits: 5,
    period: 30,
    tags: [],
  },
  {
    type: "MOTP",
    secret: "MFRGGZDFMZTWQ2LK",
    issuer: "Mobile",
    label: "m",
    algorithm: "MD5",
    digits: 6,
    period: 10,
    tags: [],
  },
];

const enc = new TextEncoder();

/** Builds the andOTP binary layout with WebCrypto: iterations(4, BE) | salt(12) | nonce(12) | ct | tag. */
export async function andotpEncrypted(
  password: string,
  entries: unknown = ANDOTP_ENTRIES,
  iterations = 1000,
  rawPayload?: string,
): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(12));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-1", salt, iterations },
    base,
    256,
  );
  const key = await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      enc.encode(rawPayload ?? JSON.stringify(entries)),
    ),
  );
  const out = new Uint8Array(4 + 12 + 12 + ct.length);
  new DataView(out.buffer).setUint32(0, iterations, false);
  out.set(salt, 4);
  out.set(nonce, 16);
  out.set(ct, 28);
  return out;
}
