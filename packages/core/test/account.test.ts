import { describe, expect, it } from "vitest";
import {
  accountDraftSchema,
  accountFingerprint,
  accountSchema,
  normalizeAccountInput,
} from "../src/account/account";
import { codeOf } from "./helpers/errors";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("normalizeAccountInput", () => {
  it("fills defaults for a bare secret", () => {
    expect(normalizeAccountInput({ secret: SECRET })).toEqual({
      type: "totp",
      secret: SECRET,
      issuer: "",
      label: "",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      counter: 0,
      domains: [],
    });
  });

  it("normalizes secret formatting and trims text", () => {
    const a = normalizeAccountInput({
      secret: " jbsw y3dp-ehpk3pxp== ",
      issuer: " GitHub ",
      label: " me@x.com ",
    });
    expect(a.secret).toBe(SECRET);
    expect(a.issuer).toBe("GitHub");
    expect(a.label).toBe("me@x.com");
  });

  it("replaces lone surrogates so the account can always be exported as a URI", () => {
    const a = normalizeAccountInput({ secret: SECRET, issuer: "a\ud800", label: "\udc00b" });
    expect(a.issuer).toBe("a�");
    expect(a.label).toBe("�b");
    expect(() => encodeURIComponent(a.issuer + a.label)).not.toThrow();
  });

  it("accepts algorithm aliases", () => {
    expect(normalizeAccountInput({ secret: SECRET, algorithm: "sha-256" }).algorithm).toBe(
      "SHA256",
    );
    expect(normalizeAccountInput({ secret: SECRET, algorithm: "sha512" }).algorithm).toBe("SHA512");
  });

  it("forces Steam parameters", () => {
    expect(
      normalizeAccountInput({
        secret: SECRET,
        type: "steam",
        digits: 8,
        algorithm: "SHA256",
        period: 60,
      }),
    ).toMatchObject({
      type: "steam",
      issuer: "Steam",
      digits: 5,
      algorithm: "SHA1",
      period: 30,
      counter: 0,
    });
  });

  it("keeps counter only for HOTP and period only for TOTP", () => {
    expect(
      normalizeAccountInput({ secret: SECRET, type: "hotp", counter: 7, period: 60 }),
    ).toMatchObject({ counter: 7, period: 30 });
    expect(
      normalizeAccountInput({ secret: SECRET, type: "totp", counter: 7, period: 60 }),
    ).toMatchObject({ counter: 0, period: 60 });
  });

  it("normalizes domains to unique sorted registrable domains", () => {
    const a = normalizeAccountInput({
      secret: SECRET,
      domains: ["https://Login.GitHub.com/x", "github.com", "chrome://x", "", "gitlab.com"],
    });
    expect(a.domains).toEqual(["github.com", "gitlab.com"]);
  });

  it.each([
    [{ secret: "not base32!" }, "invalid-base32"],
    [{ secret: SECRET, digits: 5 }, "invalid-otp-params"],
    [{ secret: SECRET, digits: 9 }, "invalid-otp-params"],
    [{ secret: SECRET, period: 0 }, "invalid-otp-params"],
    [{ secret: SECRET, period: 301 }, "invalid-otp-params"],
    [{ secret: SECRET, period: 30.5 }, "invalid-otp-params"],
    [{ secret: SECRET, type: "hotp", counter: -1 }, "invalid-otp-params"],
    [{ secret: SECRET, algorithm: "MD5" }, "unsupported-algorithm"],
    [{ secret: SECRET, type: "motp" }, "unsupported-otp-type"],
  ])("rejects %j with %s", (draft, code) => {
    expect(codeOf(() => normalizeAccountInput(draft))).toBe(code);
  });
});

describe("accountFingerprint", () => {
  it("ignores secret formatting but not type", () => {
    expect(accountFingerprint({ type: "totp", secret: "jbsw y3dp ehpk 3pxp" })).toBe(
      accountFingerprint({ type: "totp", secret: SECRET }),
    );
    expect(accountFingerprint({ type: "hotp", secret: SECRET })).not.toBe(
      accountFingerprint({ type: "totp", secret: SECRET }),
    );
  });
});

describe("schemas", () => {
  it("validates stored accounts", () => {
    const account = {
      ...normalizeAccountInput({ secret: SECRET }),
      id: "a",
      createdAt: 1,
      updatedAt: 2,
    };
    expect(accountSchema.safeParse(account).success).toBe(true);
    expect(accountSchema.safeParse({ ...account, type: "motp" }).success).toBe(false);
  });

  it("validates drafts loosely", () => {
    expect(accountDraftSchema.safeParse({ secret: SECRET, type: "whatever" }).success).toBe(true);
    expect(accountDraftSchema.safeParse({ type: "totp" }).success).toBe(false);
  });
});
