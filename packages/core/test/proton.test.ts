import { describe, expect, it } from "vitest";
import { parseImport } from "../src/importers";
import { asyncCodeOf } from "./helpers/errors";
import { protonEncrypted, protonPlain, PROTON_ENTRIES } from "./helpers/proton";

describe("Proton Authenticator import", () => {
  it("reads a plain export: otpauth, steam://, non-default params", async () => {
    const out = await parseImport(JSON.stringify(protonPlain()));
    expect(out).toMatchObject({ status: "ok", format: "proton-authenticator" });
    if (out.status !== "ok") return;
    expect(out.result.issues).toEqual([]);
    expect(
      out.result.accounts.map((a) => [a.type, a.issuer, a.label, a.digits, a.period, a.algorithm]),
    ).toEqual([
      ["totp", "Deno", "Mason", 6, 30, "SHA1"],
      ["steam", "Steam", "Sophia", 5, 30, "SHA1"],
      ["totp", "Strong", "Alice", 8, 60, "SHA512"],
    ]);
  });

  it("asks for a password, then decrypts", async () => {
    const file = JSON.stringify(await protonEncrypted("correct horse"));
    expect(await parseImport(file)).toEqual({
      status: "needs-password",
      format: "proton-authenticator",
    });
    const out = await parseImport(file, "correct horse");
    expect(out.status === "ok" && out.result.accounts).toHaveLength(3);
  });

  it("wrong password is wrong-password, short body is corrupt-file", async () => {
    const enc = await protonEncrypted("pw-one-two");
    expect(await asyncCodeOf(parseImport(JSON.stringify(enc), "nope"))).toBe("wrong-password");
    const bytes = Buffer.from(enc.content, "base64");
    bytes[bytes.length - 1]! ^= 1;
    // GCM cannot tell a wrong key from a flipped bit; both surface as wrong-password.
    expect(
      await asyncCodeOf(
        parseImport(JSON.stringify({ ...enc, content: bytes.toString("base64") }), "pw-one-two"),
      ),
    ).toBe("wrong-password");
    expect(
      await asyncCodeOf(parseImport(JSON.stringify({ ...enc, content: "AAAA" }), "pw-one-two")),
    ).toBe("corrupt-file");
  });

  it("rejects out-of-range salts as CoreError", async () => {
    const enc = await protonEncrypted("pw-one-two");
    for (const n of [7, 65]) {
      const salt = Buffer.alloc(n, 1).toString("base64");
      expect(await asyncCodeOf(parseImport(JSON.stringify({ ...enc, salt }), "pw-one-two"))).toBe(
        "corrupt-file",
      );
    }
  });

  it("malformed decrypted payload is corrupt-file without a cause", async () => {
    const enc = await protonEncrypted("pw-one-two", [], "not json {");
    const err = await parseImport(JSON.stringify(enc), "pw-one-two").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "corrupt-file", message: "Proton payload is malformed" });
    expect((err as Error).cause).toBeUndefined();
  });

  it("an unknown encrypted version fails without asking for a password", async () => {
    const out = parseImport(JSON.stringify({ version: 2, salt: "AAAA", content: "AAAA" }));
    expect(await asyncCodeOf(out)).toBe("unsupported-format");
  });

  it("does not scan a huge non-Proton entries array", async () => {
    const entries: unknown[] = Array.from({ length: 200_000 }, () => 1);
    entries.push(PROTON_ENTRIES[0]);
    expect(await parseImport(JSON.stringify({ version: 1, entries }))).toEqual({
      status: "unrecognized",
    });
  });

  it("flags a too-short steam secret as malformed", async () => {
    const entry = { id: "s", content: { uri: "steam://MFRGGZDF", name: "Short" } };
    const out = await parseImport(JSON.stringify(protonPlain([entry])));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toEqual([]);
    expect(out.result.issues).toMatchObject([{ position: 0, reason: "malformed-entry" }]);
  });

  it("reports unreadable entries instead of dropping them", async () => {
    const entries = [
      ...PROTON_ENTRIES,
      { id: "x", content: { uri: "otpauth://totp/Bad?secret=!!!", name: "Bad" } },
      { id: "y" },
    ];
    const out = await parseImport(JSON.stringify(protonPlain(entries)));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toHaveLength(3);
    expect(out.result.issues.map((i) => [i.position, i.reason])).toEqual([
      [3, "invalid-secret"],
      [4, "malformed-entry"],
    ]);
    expect(JSON.stringify(out.result.issues)).not.toContain("!!!");
  });

  it("rejects more than 10 000 entries and unknown versions", async () => {
    const many = protonPlain(Array.from({ length: 10_001 }, () => PROTON_ENTRIES[0]));
    expect(await asyncCodeOf(parseImport(JSON.stringify(many)))).toBe("unsupported-format");
    expect(
      await asyncCodeOf(
        parseImport(JSON.stringify({ version: 2, salt: "AAAA", content: "AAAA" }), "pw"),
      ),
    ).toBe("unsupported-format");
    expect(
      await asyncCodeOf(parseImport(JSON.stringify({ version: 2, entries: [PROTON_ENTRIES[0]] }))),
    ).toBe("unsupported-format");
  });
});
