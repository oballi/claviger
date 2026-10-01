import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

export const AEGIS_ENTRIES = [
  {
    type: "totp",
    uuid: "3ae6f1ad-2e65-4ed2-a953-1ec0dff2386d",
    name: "Mason",
    issuer: "Deno",
    icon: null,
    info: { secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ", algo: "SHA1", digits: 6, period: 30 },
  },
  {
    type: "hotp",
    uuid: "2f6d9a7e-0000-4000-8000-000000000002",
    name: "James",
    issuer: "Issuu",
    icon: null,
    info: { secret: "YOOMIXWS5GN6RTBPUFFWKTW5M4", algo: "SHA1", digits: 6, counter: 1 },
  },
  {
    type: "steam",
    uuid: "2f6d9a7e-0000-4000-8000-000000000003",
    name: "Sophia",
    issuer: "Boeing",
    icon: null,
    info: { secret: "JRZCL47CMXVOQMNPZR2F7J4RGI", algo: "SHA1", digits: 5, period: 30 },
  },
  {
    type: "totp",
    uuid: "2f6d9a7e-0000-4000-8000-000000000004",
    name: "x",
    issuer: "Strong",
    icon: null,
    info: { secret: "GEZDGNBVGY3TQOJQ", algo: "SHA512", digits: 8, period: 60 },
  },
  {
    type: "motp",
    uuid: "2f6d9a7e-0000-4000-8000-000000000005",
    name: "m",
    issuer: "Mobile",
    icon: null,
    info: { secret: "MFRGGZDFMZTWQ2LK", algo: "MD5", digits: 6, period: 10, pin: "1234" },
  },
];

function gcm(key: Buffer, plaintext: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ct, nonce, tag: cipher.getAuthTag() };
}

export function aegisPlain(): Record<string, unknown> {
  return {
    version: 1,
    header: { slots: null, params: null },
    db: { version: 3, entries: AEGIS_ENTRIES, groups: [] },
  };
}

export function aegisEncrypted(
  password: string,
  { n = 1024, r = 8, p = 1 } = {},
): Record<string, unknown> & {
  header: { slots: Record<string, unknown>[]; params: Record<string, string> };
} {
  const master = randomBytes(32);
  const salt = randomBytes(32);
  const kek = scryptSync(Buffer.from(password, "utf8"), salt, 32, {
    N: n,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  const wrapped = gcm(kek, master);
  const body = gcm(
    master,
    Buffer.from(JSON.stringify({ version: 3, entries: AEGIS_ENTRIES, groups: [] })),
  );
  return {
    version: 1,
    header: {
      slots: [
        { type: 2, uuid: "biometric-slot", key: "00", key_params: { nonce: "00", tag: "00" } },
        {
          type: 1,
          uuid: "01234567-89ab-cdef-0123-456789abcdef",
          key: wrapped.ct.toString("hex"),
          key_params: { nonce: wrapped.nonce.toString("hex"), tag: wrapped.tag.toString("hex") },
          n,
          r,
          p,
          salt: salt.toString("hex"),
        },
      ],
      params: { nonce: body.nonce.toString("hex"), tag: body.tag.toString("hex") },
    },
    db: body.ct.toString("base64"),
  };
}
