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
});
