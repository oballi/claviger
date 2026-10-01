import { describe, expect, it } from "vitest";
import { aegisNeedsPassword, isAegisFile, parseAegis } from "../src/importers/aegis";
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
});
