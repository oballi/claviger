import { argon2id } from "hash-wasm";
import { describe, expect, it } from "vitest";
import {
  isUpstreamBackup,
  parseUpstreamBackup,
  upstreamNeedsPassword,
} from "../src/importers/upstream";
import { asyncCodeOf } from "./helpers/errors";
import {
  EXPECTED_ACCOUNTS,
  legacyKeyBackup,
  plainBackup,
  v2Backup,
  v3Backup,
} from "./helpers/upstream";

const GOST_ISSUE = expect.objectContaining({
  position: 5,
  reason: "unsupported-algorithm",
  name: "Gost: frank",
});

describe("upstream Authenticator backups", () => {
  it("detects backups and whether they need a password", async () => {
    expect(isUpstreamBackup(plainBackup())).toBe(true);
    expect(upstreamNeedsPassword(plainBackup())).toBe(false);
    expect(upstreamNeedsPassword(v2Backup("pw"))).toBe(true);
    expect(upstreamNeedsPassword(await v3Backup("pw"))).toBe(true);
    expect(isUpstreamBackup({ version: 1, header: {}, db: {} })).toBe(false);
    expect(isUpstreamBackup([1, 2])).toBe(false);
  });

  it("imports plain backups, converting hex/battle and keeping autofill hosts", async () => {
    const result = await parseUpstreamBackup(plainBackup());
    expect(result.accounts).toEqual(EXPECTED_ACCOUNTS);
    expect(result.issues).toEqual([GOST_ISSUE]);
  });

  it("handles secret prefixes, hhex and hex-looking TOTP secrets in plain backups", async () => {
    const entry = (secret: string, type: string) => ({ secret, type, encrypted: false });
    const result = await parseUpstreamBackup({
      a: entry("stm-MFRGGZDFMZTWQ2LK", "totp"),
      b: entry("blz-KRUGKIDROVUWG2ZA", "totp"),
      c: entry("bliz-KRUGKIDROVUWG2ZA", "totp"),
      d: entry("3132333435363738393031323334353637383930", "hhex"),
      e: entry("3132333435363738393031323334353637383930", "totp"),
    });
    expect(result.issues).toEqual([]);
    expect(result.accounts).toMatchObject([
      { type: "steam", secret: "MFRGGZDFMZTWQ2LK" },
      { type: "totp", secret: "KRUGKIDROVUWG2ZA", digits: 8 },
      { type: "totp", secret: "KRUGKIDROVUWG2ZA", digits: 8 },
      { type: "hotp", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
      { type: "totp", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 6 },
    ]);
  });

  it("imports v2 backups (encrypted secrets)", async () => {
    const result = await parseUpstreamBackup(v2Backup("pässword"), "pässword");
    expect(result.accounts).toEqual(EXPECTED_ACCOUNTS);
  });

  it("imports backups with the legacy key object", async () => {
    expect((await parseUpstreamBackup(legacyKeyBackup("pw"), "pw")).accounts).toEqual(
      EXPECTED_ACCOUNTS,
    );
  });

  it("imports v3 backups (Argon2id key + EncOTPStorage)", async () => {
    const result = await parseUpstreamBackup(await v3Backup("correct horse"), "correct horse");
    expect(result.accounts).toEqual(EXPECTED_ACCOUNTS);
    expect(result.issues).toEqual([GOST_ISSUE]);
  });

  it("fails loudly with a wrong or missing password instead of importing nothing", async () => {
    const v3 = await v3Backup("correct horse");
    expect(await asyncCodeOf(parseUpstreamBackup(v3, "wrong"))).toBe("wrong-password");
    expect(await asyncCodeOf(parseUpstreamBackup(v3))).toBe("wrong-password");
    expect(await asyncCodeOf(parseUpstreamBackup(v2Backup("pw"), "nope"))).toBe("wrong-password");
    expect(await asyncCodeOf(parseUpstreamBackup(legacyKeyBackup("pw"), "nope"))).toBe(
      "wrong-password",
    );
  });

  it("refuses unreasonable Argon2 parameters before hashing (DoS guard)", async () => {
    const evil = await v3Backup("pw", "$argon2id$v=19$m=4194304,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAA");
    expect(await asyncCodeOf(parseUpstreamBackup(evil, "pw"))).toBe("corrupt-file");
  });

  it("rejects non-backups", async () => {
    expect(await asyncCodeOf(parseUpstreamBackup({ hello: "world" }))).toBe("unsupported-format");
  });

  it("rejects a crafted v3 salt that is too short", async () => {
    const backup = await v3Backup("pw");
    const keyId = "9f0c7c1e-1111-4111-8111-111111111111";
    backup[keyId] = { ...(backup[keyId] as object), salt: "abc" };
    expect(await asyncCodeOf(parseUpstreamBackup(backup, "pw"))).toBe("corrupt-file");
  });

  it("reports a malformed key hash as corrupt-file, not wrong-password", async () => {
    const bad = await v3Backup("pw", "$argon2id$v=19$m=19456,t=2,p=1$!!!$!!!");
    expect(await asyncCodeOf(parseUpstreamBackup(bad, "pw"))).toBe("corrupt-file");
  });

  it("turns entries with invalid numeric params into issues instead of dropping them", async () => {
    const result = await parseUpstreamBackup({
      a: { secret: "JBSWY3DPEHPK3PXP", digits: "abc", type: "totp" },
      b: { secret: "GEZDGNBVGY3TQOJQ", type: "totp" },
    });
    expect(result.accounts).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ position: 0, reason: "invalid-params" }),
    ]);
  });

  it("reports entries with a secret that fail the schema as malformed", async () => {
    const result = await parseUpstreamBackup({
      a: { secret: 42 },
      b: { secret: "GEZDGNBVGY3TQOJQ" },
    });
    expect(result.accounts).toHaveLength(1);
    expect(result.issues).toEqual([{ position: 0, name: "", reason: "malformed-entry" }]);
  });

  it("reports malformed EncOTPStorage entries as issues instead of dropping them", async () => {
    const result = await parseUpstreamBackup({
      a: { dataType: "EncOTPStorage", data: "x" },
      b: { dataType: "EncOTPStorage", keyId: "k", data: 5 },
      c: { secret: "GEZDGNBVGY3TQOJQ" },
    });
    expect(result.accounts).toHaveLength(1);
    expect(result.issues).toEqual([
      { position: 0, name: "", reason: "malformed-entry" },
      { position: 1, name: "", reason: "malformed-entry" },
    ]);
  });

  describe("distinct v3 key cap", () => {
    const password = "pw";
    async function keyedBackup(count: number): Promise<Record<string, unknown>> {
      const file: Record<string, unknown> = {};
      for (let i = 0; i < count; i++) {
        const salt = `salt-salt-${i}`;
        const encoded = await argon2id({ password, salt, ...ARGON, outputType: "encoded" });
        const hash = await argon2id({
          password: encoded.split("$")[5]!,
          salt: "0011223344556677",
          ...ARGON,
          outputType: "encoded",
        });
        file[`k${i}`] = { dataType: "Key", id: `k${i}`, salt, hash };
        file[`e${i}`] = { dataType: "EncOTPStorage", keyId: `k${i}`, data: "U2FsdGVkX1" };
      }
      return file;
    }
    const ARGON = { iterations: 2, parallelism: 1, memorySize: 19456, hashLength: 32 } as const;

    it("rejects more than 4 distinct keyIds before deriving any key", async () => {
      // Wrong password: without the cap this would run Argon2id and answer wrong-password.
      const file = await keyedBackup(5);
      const t0 = performance.now();
      expect(await asyncCodeOf(parseUpstreamBackup(file, "wrong"))).toBe("corrupt-file");
      expect(performance.now() - t0).toBeLessThan(500);
    });

    it("still derives for exactly 4 distinct keyIds", async () => {
      const file = await keyedBackup(4);
      expect(await asyncCodeOf(parseUpstreamBackup(file, "wrong"))).toBe("wrong-password");
    });
  });
});
