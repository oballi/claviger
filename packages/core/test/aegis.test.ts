import { describe, expect, it } from "vitest";
import { aegisNeedsPassword, isAegisFile, parseAegis } from "../src/importers/aegis";
import { isCoreError } from "../src/errors";
import { asyncCodeOf } from "./helpers/errors";
import { aegisEncrypted, aegisPlain } from "./helpers/aegis";

const EXPECTED = [
  {
    type: "totp",
    secret: "4SJHB4GSD43FZBAI7C2HLRJGPQ",
    issuer: "Deno",
    label: "Mason",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 0,
    domains: [],
  },
  {
    type: "hotp",
    secret: "YOOMIXWS5GN6RTBPUFFWKTW5M4",
    issuer: "Issuu",
    label: "James",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    counter: 1,
    domains: [],
  },
  {
    type: "steam",
    secret: "JRZCL47CMXVOQMNPZR2F7J4RGI",
    issuer: "Boeing",
    label: "Sophia",
    algorithm: "SHA1",
    digits: 5,
    period: 30,
    counter: 0,
    domains: [],
  },
  {
    type: "totp",
    secret: "GEZDGNBVGY3TQOJQ",
    issuer: "Strong",
    label: "x",
    algorithm: "SHA512",
    digits: 8,
    period: 60,
    counter: 0,
    domains: [],
  },
];

describe("Aegis import", () => {
  it("imports a vault encrypted with the real Aegis scrypt defaults (n=2^15, r=8, p=1)", async () => {
    const file = aegisEncrypted("test", { n: 32768, r: 8, p: 1 });
    expect((await parseAegis(file, "test")).accounts).toEqual(EXPECTED);
  });
  it("does not attach decrypted plaintext to the error when the body is not JSON", async () => {
    const file = aegisEncrypted("test", { plaintext: "{SECRET-PLAINTEXT" });
    const error = await parseAegis(file, "test").catch((e: unknown) => e);
    expect(isCoreError(error, "corrupt-file")).toBe(true);
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain("SECRET-PLAINTEXT");
  });

  it("detects plain and encrypted vaults", () => {
    expect(isAegisFile(aegisPlain())).toBe(true);
    expect(aegisNeedsPassword(aegisPlain())).toBe(false);
    expect(aegisNeedsPassword(aegisEncrypted("test"))).toBe(true);
    expect(isAegisFile({ services: [] })).toBe(false);
  });

  it("imports a plain vault and reports unsupported entries", async () => {
    const result = await parseAegis(aegisPlain());
    expect(result.accounts).toEqual(EXPECTED);
    expect(result.issues).toEqual([
      expect.objectContaining({ position: 4, reason: "unsupported-type", name: "Mobile: m" }),
    ]);
  });

  it("imports an encrypted vault", async () => {
    expect((await parseAegis(aegisEncrypted("test"), "test")).accounts).toEqual(EXPECTED);
  });

  it("fails with wrong-password for a wrong or missing password", async () => {
    const file = aegisEncrypted("test");
    expect(await asyncCodeOf(parseAegis(file, "nope"))).toBe("wrong-password");
    expect(await asyncCodeOf(parseAegis(file))).toBe("wrong-password");
  });

  it("refuses unreasonable scrypt parameters before deriving (DoS guard)", async () => {
    const file = aegisEncrypted("test");
    file.header.slots[1]!.n = 2 ** 30;
    expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
  });

  it("reports a tampered body as corrupt", async () => {
    const file = aegisEncrypted("test");
    file.header.params.tag = "00".repeat(16);
    expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
  });

  it("rejects unknown content versions", async () => {
    const file = aegisPlain() as { db: { version: number } };
    file.db.version = 99;
    expect(await asyncCodeOf(parseAegis(file))).toBe("unsupported-format");
  });

  describe("Crafted input DoS guards", () => {
    it("guards against scrypt r bypass: n=2, r=2^20, p=4", async () => {
      const file = aegisEncrypted("test");
      file.header.slots[1]!.n = 2;
      file.header.slots[1]!.r = 2 ** 20;
      file.header.slots[1]!.p = 4;
      expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
    });

    it("rejects vaults with more than 4 password slots", async () => {
      const file = aegisEncrypted("test");
      const validSlot = file.header.slots[1]!;
      file.header.slots[1] = validSlot;
      file.header.slots[2] = validSlot;
      file.header.slots[3] = validSlot;
      file.header.slots[4] = validSlot;
      file.header.slots[5] = validSlot;
      expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
    });

    it("rejects vaults with null params", async () => {
      const file = aegisEncrypted("test") as { header: { params: null | Record<string, string> } };
      file.header.params = null;
      expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
    });

    it("rejects vaults with no password slot", async () => {
      const file = aegisEncrypted("test");
      file.header.slots = [
        { type: 2, uuid: "biometric-slot", key: "00", key_params: { nonce: "00", tag: "00" } },
      ];
      expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
    });

    it("rejects non-hex salt in password slot", async () => {
      const file = aegisEncrypted("test");
      file.header.slots[1]!.salt = "not-hex!@#$";
      expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
    });

    it("rejects non-base64 ciphertext body", async () => {
      const file = aegisEncrypted("test");
      file.db = "not base64!";
      expect(await asyncCodeOf(parseAegis(file, "test"))).toBe("corrupt-file");
    });

    it("reports malformed plain vault entries as issues", async () => {
      const file = aegisPlain() as { db: { entries: unknown[] } };
      file.db.entries.push({ type: "totp" });
      const result = await parseAegis(file);
      expect(result.accounts).toEqual(EXPECTED);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ position: 5, reason: "malformed-entry", name: "" }),
      );
    });
  });
});
