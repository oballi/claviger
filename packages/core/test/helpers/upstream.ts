import CryptoJS from "crypto-js";
import { argon2id } from "hash-wasm";

const RAW = {
  "0b6a7b4e-0000-4000-8000-000000000001": {
    account: "alice",
    issuer: "GitHub::github.com",
    secret: "JBSWY3DPEHPK3PXP",
    type: "totp",
    encrypted: false,
    index: 0,
  },
  "0b6a7b4e-0000-4000-8000-000000000002": {
    account: "bob",
    issuer: "Bank",
    secret: "GEZDGNBVGY3TQOJQ",
    type: "hotp",
    counter: 7,
    encrypted: false,
    index: 1,
  },
  "0b6a7b4e-0000-4000-8000-000000000003": {
    account: "carol",
    issuer: "Valve",
    secret: "MFRGGZDFMZTWQ2LK",
    type: "steam",
    encrypted: false,
    index: 2,
  },
  "0b6a7b4e-0000-4000-8000-000000000004": {
    account: "dave",
    issuer: "HexCo",
    secret: "3132333435363738393031323334353637383930",
    type: "hex",
    encrypted: false,
    index: 3,
  },
  "0b6a7b4e-0000-4000-8000-000000000005": {
    account: "erin",
    issuer: "Blizzard",
    secret: "KRUGKIDROVUWG2ZA",
    type: "battle",
    encrypted: false,
    index: 4,
  },
  "0b6a7b4e-0000-4000-8000-000000000006": {
    account: "frank",
    issuer: "Gost",
    secret: "ONSWG4TFOQ",
    type: "totp",
    algorithm: "GOST3411_2012_256",
    encrypted: false,
    index: 5,
  },
  "0b6a7b4e-0000-4000-8000-000000000007": {
    account: "grace",
    issuer: "AWS",
    secret: "MZXW6YTBOI",
    type: "totp",
    algorithm: "SHA256",
    digits: 8,
    period: 60,
    encrypted: false,
    index: 6,
  },
} as const;

export function plainBackup(): Record<string, unknown> {
  return structuredClone(RAW) as Record<string, unknown>;
}

export function v2Backup(password: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [hash, entry] of Object.entries(RAW)) {
    out[hash] = {
      ...entry,
      encrypted: true,
      secret: CryptoJS.AES.encrypt(entry.secret, password).toString(),
    };
  }
  return out;
}

export function legacyKeyBackup(password: string): Record<string, unknown> {
  const innerKey = "legacy-inner-key-1234";
  const entryPassphrase = Buffer.from(innerKey, "utf8").toString("hex");
  const out: Record<string, unknown> = {
    key: { enc: CryptoJS.AES.encrypt(innerKey, password).toString(), hash: "unused" },
  };
  for (const [hash, entry] of Object.entries(RAW)) {
    out[hash] = {
      ...entry,
      encrypted: true,
      secret: CryptoJS.AES.encrypt(entry.secret, entryPassphrase).toString(),
    };
  }
  return out;
}

const UPSTREAM_ARGON = {
  iterations: 2,
  parallelism: 1,
  memorySize: 19456,
  hashLength: 32,
} as const;

export async function v3Backup(
  password: string,
  keyHashOverride?: string,
): Promise<Record<string, unknown>> {
  const keyId = "9f0c7c1e-1111-4111-8111-111111111111";
  const salt = "a1b2c3d4e5f60718";
  const encoded = await argon2id({ password, salt, ...UPSTREAM_ARGON, outputType: "encoded" });
  const entryPassphrase = encoded.split("$")[5]!;
  const keyHash =
    keyHashOverride ??
    (await argon2id({
      password: entryPassphrase,
      salt: "0011223344556677",
      ...UPSTREAM_ARGON,
      outputType: "encoded",
    }));
  const out: Record<string, unknown> = {
    [keyId]: { dataType: "Key", id: keyId, salt, hash: keyHash, version: 3 },
  };
  for (const [hash, entry] of Object.entries(RAW)) {
    const { encrypted: _ignored, ...rest } = entry;
    out[hash] = {
      dataType: "EncOTPStorage",
      keyId,
      index: entry.index,
      data: CryptoJS.AES.encrypt(
        JSON.stringify({ ...rest, hash, dataType: "OTPStorage", encrypted: false }),
        entryPassphrase,
      ).toString(),
    };
  }
  return out;
}

/** Expected import result for all formats (the GOST record becomes an issue). */
export const EXPECTED_ACCOUNTS = [
  {
    type: "totp",
    secret: "JBSWY3DPEHPK3PXP",
    issuer: "GitHub",
    label: "alice",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 0,
    domains: ["github.com"],
  },
  {
    type: "hotp",
    secret: "GEZDGNBVGY3TQOJQ",
    issuer: "Bank",
    label: "bob",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 7,
    domains: [],
  },
  {
    type: "steam",
    secret: "MFRGGZDFMZTWQ2LK",
    issuer: "Valve",
    label: "carol",
    algorithm: "SHA1",
    digits: 5,
    period: 30,
    counter: 0,
    domains: [],
  },
  {
    type: "totp",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    issuer: "HexCo",
    label: "dave",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 0,
    domains: [],
  },
  {
    type: "totp",
    secret: "KRUGKIDROVUWG2ZA",
    issuer: "Blizzard",
    label: "erin",
    algorithm: "SHA1",
    digits: 8,
    period: 30,
    counter: 0,
    domains: [],
  },
  {
    type: "totp",
    secret: "MZXW6YTBOI",
    issuer: "AWS",
    label: "grace",
    algorithm: "SHA256",
    digits: 8,
    period: 60,
    counter: 0,
    domains: [],
  },
];
