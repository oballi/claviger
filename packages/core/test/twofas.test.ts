import { describe, expect, it } from "vitest";
import { isTwofasFile, parseTwofas, twofasNeedsPassword } from "../src/importers/twofas";
import { isCoreError } from "../src/errors";
import { asyncCodeOf } from "./helpers/errors";
import { twofasEncrypted, twofasPlain } from "./helpers/twofas";

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
    issuer: "Fallback",
    label: "f",
    algorithm: "SHA256",
    digits: 8,
    period: 60,
    counter: 0,
    domains: [],
  },
];

describe("2FAS import", () => {
  it("detects files and encryption", () => {
    expect(isTwofasFile(twofasPlain())).toBe(true);
    expect(twofasNeedsPassword(twofasPlain())).toBe(false);
    expect(twofasNeedsPassword(twofasEncrypted("test"))).toBe(true);
    expect(isTwofasFile({ version: 1, header: {}, db: {} })).toBe(false);
  });

  it("imports plain files and reports unsupported token types", async () => {
    const result = await parseTwofas(twofasPlain());
    expect(result.accounts).toEqual(EXPECTED);
    expect(result.issues).toEqual([
      expect.objectContaining({ position: 4, reason: "unsupported-type", name: "Odd: o" }),
    ]);
  });

  it("imports encrypted files", async () => {
    expect((await parseTwofas(twofasEncrypted("test"), "test")).accounts).toEqual(EXPECTED);
  });

  it("fails with wrong-password for a wrong or missing password", async () => {
    const file = twofasEncrypted("test");
    expect(await asyncCodeOf(parseTwofas(file, "nope"))).toBe("wrong-password");
    expect(await asyncCodeOf(parseTwofas(file))).toBe("wrong-password");
  });

  it("treats an empty servicesEncrypted as a corrupt encrypted payload, not a plain file", async () => {
    const file = { ...twofasPlain(), servicesEncrypted: "" };
    expect(await asyncCodeOf(parseTwofas(file, "x"))).toBe("corrupt-file");
  });

  it("falls back to otp.label when otp.account is empty", async () => {
    const file = {
      schemaVersion: 4,
      services: [{ name: "Svc", secret: "JBSWY3DPEHPK3PXP", otp: { account: "", label: "lbl" } }],
    };
    const result = await parseTwofas(file);
    expect(result.accounts[0]?.label).toBe("lbl");
  });

  it("does not attach decrypted plaintext to the error when the payload is not JSON", async () => {
    const error = await parseTwofas(twofasEncrypted("pw", "{SECRET-PLAINTEXT"), "pw").catch(
      (e: unknown) => e,
    );
    expect(isCoreError(error, "corrupt-file")).toBe(true);
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain("SECRET-PLAINTEXT");
  });

  it("rejects malformed encrypted payloads and newer schema versions", async () => {
    expect(
      await asyncCodeOf(parseTwofas({ schemaVersion: 4, servicesEncrypted: "only:two" }, "x")),
    ).toBe("corrupt-file");
    expect(
      await asyncCodeOf(parseTwofas({ schemaVersion: 4, servicesEncrypted: "!!:!!:!!" }, "x")),
    ).toBe("corrupt-file");
    expect(
      await asyncCodeOf(
        parseTwofas({ schemaVersion: 4, servicesEncrypted: "AAAAAAAAAAAAAAAAAAAAAA==:AAAA:" }, "x"),
      ),
    ).toBe("corrupt-file");
    expect(await asyncCodeOf(parseTwofas({ ...twofasPlain(), schemaVersion: 5 }))).toBe(
      "unsupported-format",
    );
  });
});
