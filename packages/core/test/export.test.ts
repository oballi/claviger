import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { exportOtpauthText } from "../src/exporters/otpauthText";
import { exportOtpvault, isOtpvaultExport, parseOtpvaultExport } from "../src/exporters/otpvault";
import { parseOtpauthText } from "../src/importers/otpauthText";
import { sealBytes } from "../src/crypto/aes";
import { utf8Encode } from "../src/encoding/bytes";
import { isCoreError } from "../src/errors";
import { webRandom } from "../src/ports";
import { FAST_KDF } from "../src/testing";
import { createPasswordKeyslot } from "../src/vault/keyslot";
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

  it("binds the payload to the exportId", async () => {
    const json = JSON.parse(await exportOtpvault(accounts, "pw", makeDeps()));
    const code = await asyncCodeOf(
      parseOtpvaultExport({ ...json, exportId: webRandom.uuid() }, "pw"),
    );
    expect(["wrong-password", "corrupt-file"]).toContain(code);
  });

  it("uses a fresh exportId, salt and iv for every export", async () => {
    const one = JSON.parse(await exportOtpvault(accounts, "pw", makeDeps()));
    const two = JSON.parse(await exportOtpvault(accounts, "pw", makeDeps()));
    expect(one.exportId).not.toBe(two.exportId);
    expect(one.keyslots[0].kdf.salt).not.toBe(two.keyslots[0].kdf.salt);
    expect(one.payload.iv).not.toBe(two.payload.iv);
  });

  it("does not attach decrypted plaintext to the error when the payload is not JSON", async () => {
    const exportId = webRandom.uuid();
    const fileKey = webRandom.bytes(32);
    const keyslot = await createPasswordKeyslot(fileKey, "pw", exportId, webRandom, FAST_KDF);
    const payload = await sealBytes(
      fileKey,
      utf8Encode("{SECRET-PLAINTEXT"),
      `otp-vault/v1/export/${exportId}`,
      webRandom,
    );
    const file = {
      format: "otp-vault-export",
      version: 1,
      exportId,
      createdAt: 0,
      keyslots: [keyslot],
      payload,
    };
    const error = await parseOtpvaultExport(file, "pw").catch((e: unknown) => e);
    expect(isCoreError(error, "corrupt-file")).toBe(true);
    expect((error as Error).cause).toBeUndefined();
    expect((error as Error).message).not.toContain("SECRET-PLAINTEXT");
  });

  it("reports an export from a newer version as unsupported, not corrupt", async () => {
    const json = JSON.parse(await exportOtpvault(accounts, "pw", makeDeps()));
    expect(await asyncCodeOf(parseOtpvaultExport({ ...json, version: 2 }, "pw"))).toBe(
      "unsupported-format",
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
