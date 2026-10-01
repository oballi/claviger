import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

export const TWOFAS_SERVICES = [
  {
    name: "Deno",
    secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ",
    otp: {
      account: "Mason",
      issuer: "Deno",
      digits: 6,
      period: 30,
      algorithm: "SHA1",
      tokenType: "TOTP",
    },
  },
  {
    name: "Issuu",
    secret: "YOOMIXWS5GN6RTBPUFFWKTW5M4",
    otp: { account: "James", digits: 6, algorithm: "SHA1", counter: 1, tokenType: "HOTP" },
  },
  {
    name: "Boeing",
    secret: "JRZCL47CMXVOQMNPZR2F7J4RGI",
    otp: { account: "Sophia", tokenType: "STEAM" },
  },
  {
    name: "",
    secret: "GEZDGNBVGY3TQOJQ",
    otp: {
      issuer: "Fallback",
      label: "f",
      tokenType: "TOTP",
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    },
  },
  { name: "Odd", secret: "MFRGGZDFMZTWQ2LK", otp: { account: "o", tokenType: "YAOTP" } },
];

export function twofasPlain(): Record<string, unknown> {
  return {
    services: TWOFAS_SERVICES,
    groups: [],
    updatedAt: 1702934567518,
    schemaVersion: 4,
    appOrigin: "android",
  };
}

export function twofasEncrypted(
  password: string,
  plaintext = JSON.stringify(TWOFAS_SERVICES),
): Record<string, unknown> {
  const salt = randomBytes(256);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(Buffer.from(password, "utf8"), salt, 10_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return {
    services: [],
    groups: [],
    schemaVersion: 4,
    servicesEncrypted: `${ct.toString("base64")}:${salt.toString("base64")}:${iv.toString("base64")}`,
    reference: "ignored",
  };
}
