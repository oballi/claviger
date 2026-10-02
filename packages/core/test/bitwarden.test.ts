import { describe, expect, it } from "vitest";
import { parseImport } from "../src/importers";
import { asyncCodeOf } from "./helpers/errors";
import { bitwardenAuthenticator, bitwardenVault } from "./helpers/bitwarden";

const ok = async (value: unknown) => {
  const out = await parseImport(JSON.stringify(value));
  if (out.status !== "ok") throw new Error("expected ok");
  return out;
};

describe("Bitwarden JSON import", () => {
  it("reads an Authenticator export incl. Steam, bare Base32 and 8-digit Battle.net", async () => {
    const out = await ok(bitwardenAuthenticator());
    expect(out.format).toBe("bitwarden");
    expect(out.result.issues).toEqual([]);
    expect(
      out.result.accounts.map((a) => [a.type, a.issuer, a.label, a.digits, a.period, a.algorithm]),
    ).toEqual([
      ["totp", "Deno", "mason@example.test", 6, 30, "SHA1"],
      ["steam", "Steam", "gaben", 5, 30, "SHA1"],
      ["totp", "Bare", "u", 6, 30, "SHA1"],
      ["totp", "Battle.net", "player", 8, 30, "SHA1"],
    ]);
    expect(out.result.accounts[2]!.secret).toBe("GEZDGNBVGY3TQOJQ");
  });

  it("ignores password and note items without reporting them", async () => {
    const out = await ok(bitwardenVault());
    expect(out.result.accounts).toHaveLength(4);
    expect(out.result.issues).toEqual([]);
    expect(JSON.stringify(out.result)).not.toContain("SYNTHETIC-NOT-A-REAL-PASSWORD");
  });

  it("reports an invalid secret without echoing it", async () => {
    const file = bitwardenAuthenticator();
    file.items[0]!.login.totp = "otpauth://totp/x?secret=!!!";
    const out = await ok(file);
    expect(out.result.issues[0]!.reason).toBe("invalid-secret");
    expect(JSON.stringify(out.result.issues)).not.toContain("!!!");
  });

  it("rejects password-protected and account-restricted encrypted exports", async () => {
    const protectedFile = {
      encrypted: true,
      passwordProtected: true,
      salt: "x",
      kdfType: 0,
      kdfIterations: 600000,
      encKeyValidation_DO_NOT_EDIT: "2.x|y|z",
      data: "2.a|b|c",
    };
    const restricted = {
      encrypted: true,
      items: [{ id: "1", type: 1, name: "2.x|y|z", login: { totp: "2.a|b|c" } }],
    };
    for (const file of [protectedFile, restricted]) {
      const err = await parseImport(JSON.stringify(file)).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "unsupported-format" });
      expect((err as Error).message).toContain("unencrypted");
    }
  });

  it("rejects more than 10 000 items", async () => {
    const items = Array.from({ length: 10_001 }, () => bitwardenAuthenticator().items[0]);
    expect(await asyncCodeOf(parseImport(JSON.stringify({ encrypted: false, items })))).toBe(
      "unsupported-format",
    );
  });

  it("does not claim unrelated JSON with an items key", async () => {
    expect(await parseImport(JSON.stringify({ items: [{ a: 1 }] }))).toEqual({
      status: "unrecognized",
    });
  });

  it("flags a too-short steam secret as malformed", async () => {
    const out = await ok({
      items: [
        { id: "1", type: 1, name: "Steam", login: { username: "u", totp: "steam://MFRGGZDF" } },
      ],
    });
    expect(out.result.accounts).toEqual([]);
    expect(out.result.issues).toMatchObject([{ position: 0, reason: "malformed-entry" }]);
  });
});
