import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { exportOtpauthText } from "../src/exporters/otpauthText";
import { exportOtpvault, isOtpvaultExport, parseOtpvaultExport } from "../src/exporters/otpvault";
import { parseOtpauthText } from "../src/importers/otpauthText";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

const accounts = [
  normalizeAccountInput({
    secret: "JBSWY3DPEHPK3PXP",
    issuer: "GitHub",
    label: "me",
    domains: ["github.com"],
  }),
  normalizeAccountInput({
    secret: "GEZDGNBVGY3TQOJQ",
    issuer: "Bank",
    label: "you",
    type: "hotp",
    counter: 9,
  }),
  normalizeAccountInput({ secret: "MFRGGZDFMZTWQ2LK", type: "steam", label: "gamer" }),
];

describe(".otpvault export", () => {
  it("round-trips accounts (including domains and order) with the export password", async () => {
    const text = await exportOtpvault(accounts, "export-pw", makeDeps());
    const json = JSON.parse(text);
    expect(isOtpvaultExport(json)).toBe(true);
    expect(text).not.toContain("JBSWY3DPEHPK3PXP");
    expect(text).not.toContain("GitHub");
    const result = await parseOtpvaultExport(json, "export-pw");
    expect(result).toEqual({ accounts, issues: [] });
  });

  it("strips vault-only fields from Account objects", async () => {
    const withIds = accounts.map((a, i) => ({ ...a, id: `id-${i}`, createdAt: 1, updatedAt: 2 }));
    const result = await parseOtpvaultExport(
      JSON.parse(await exportOtpvault(withIds, "pw", makeDeps())),
      "pw",
    );
    expect(result.accounts).toEqual(accounts);
  });

  it("rejects a wrong password, tampering and absurd KDF parameters", async () => {
    const json = JSON.parse(await exportOtpvault(accounts, "pw", makeDeps()));
    expect(await asyncCodeOf(parseOtpvaultExport(json, "wrong"))).toBe("wrong-password");
    const tampered = structuredClone(json);
    tampered.payload.ct = tampered.payload.ct.replace(/^./, (c: string) => (c === "A" ? "B" : "A"));
    expect(await asyncCodeOf(parseOtpvaultExport(tampered, "pw"))).toBe("corrupt-file");
    const evil = structuredClone(json);
    evil.keyslots[0].kdf.memoryKiB = 4_194_304;
    expect(await asyncCodeOf(parseOtpvaultExport(evil, "pw"))).toBe("corrupt-file");
    const tinySalt = structuredClone(json);
    tinySalt.keyslots[0].kdf.salt = "AAAA";
    expect(await asyncCodeOf(parseOtpvaultExport(tinySalt, "pw"))).toBe("corrupt-file");
    expect(await asyncCodeOf(parseOtpvaultExport({ format: "otp-vault-export" }, "pw"))).toBe(
      "corrupt-file",
    );
  });

  it("does not claim other JSON", () => {
    expect(isOtpvaultExport({ version: 1 })).toBe(false);
    expect(isOtpvaultExport(null)).toBe(false);
  });
});

describe("otpauth text export", () => {
  it("writes one URI per line that imports back identically (minus domains)", () => {
    const text = exportOtpauthText(accounts);
    expect(text.trim().split("\n")).toHaveLength(3);
    expect(parseOtpauthText(text).accounts).toEqual(accounts.map((a) => ({ ...a, domains: [] })));
  });
});
