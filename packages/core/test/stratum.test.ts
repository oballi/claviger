import { describe, expect, it } from "vitest";
import { parseImport } from "../src/importers";
import { encodeBinaryImport } from "../src/importers/binary";
import { ANDOTP_ENTRIES } from "./helpers/andotp";
import { asyncCodeOf } from "./helpers/errors";
import { STRATUM_JSON, stratumEncrypted, stratumLegacy } from "./helpers/stratum";

const okResult = async (text: string, password?: string) => {
  const out = await parseImport(text, password);
  if (out.status !== "ok") throw new Error(`expected ok, got ${out.status}`);
  return out;
};

describe("Stratum import", () => {
  it("maps types, algorithm indices and a null username; reports other types", async () => {
    const out = await okResult(JSON.stringify(STRATUM_JSON));
    expect(out.format).toBe("stratum");
    expect(out.result.accounts.map((a) => [a.type, a.issuer, a.label, a.algorithm])).toEqual([
      ["totp", "Deno", "Mason", "SHA1"],
      ["hotp", "Issuu", "", "SHA256"],
      ["steam", "Steam", "Sophia", "SHA1"],
      ["totp", "Big", "512", "SHA512"],
    ]);
    expect(out.result.accounts[1]).toMatchObject({ counter: 9, digits: 7 });
    expect(out.result.accounts[3]).toMatchObject({ period: 60, digits: 8 });
    expect(out.result.issues).toMatchObject([{ position: 3, reason: "unsupported-type" }]);
  });

  it("reports unknown types and out-of-range algorithms without dropping the file", async () => {
    const base = STRATUM_JSON.Authenticators[0]!;
    const out = await okResult(
      JSON.stringify({
        Authenticators: [{ ...base, Type: 5 }, { ...base, Algorithm: 9 }, { Type: 2 }, base],
      }),
    );
    expect(out.result.accounts).toHaveLength(1);
    expect(out.result.issues.map((i) => i.reason)).toEqual([
      "unsupported-type",
      "unsupported-algorithm",
      "malformed-entry",
    ]);
  });

  it("rejects a too-short Steam secret", async () => {
    const out = await okResult(
      JSON.stringify({ Authenticators: [{ ...STRATUM_JSON.Authenticators[2]!, Secret: "MFRGG" }] }),
    );
    expect(out.result.accounts).toHaveLength(0);
    expect(out.result.issues).toHaveLength(1);
  });

  it("does not claim other formats", async () => {
    const out = await parseImport(JSON.stringify(ANDOTP_ENTRIES));
    expect(out).toMatchObject({ format: "andotp" });
    expect(await parseImport(JSON.stringify({ Authenticators: "x" }))).toEqual({
      status: "unrecognized",
    });
  });

  it("rejects more than 10 000 entries", async () => {
    const many = {
      Authenticators: Array.from({ length: 10_001 }, () => STRATUM_JSON.Authenticators[0]),
    };
    expect(await asyncCodeOf(parseImport(JSON.stringify(many)))).toBe("unsupported-format");
  });

  it("does not scan a huge junk list for detection", async () => {
    const big: unknown[] = Array.from({ length: 200_000 }, () => 1);
    big.push(STRATUM_JSON.Authenticators[0]);
    expect(await parseImport(JSON.stringify({ Authenticators: big }))).toEqual({
      status: "unrecognized",
    });
  });

  it("decrypts the Argon2id form; wrong password and truncation fail cleanly", async () => {
    const bytes = await stratumEncrypted("pw");
    const text = encodeBinaryImport(bytes);
    expect(await parseImport(text)).toEqual({ status: "needs-password", format: "stratum" });
    const out = await okResult(text, "pw");
    expect(out.format).toBe("stratum");
    expect(out.result.accounts).toHaveLength(4);
    expect(await asyncCodeOf(parseImport(text, "other"))).toBe("wrong-password");
    const cut = encodeBinaryImport(bytes.subarray(0, 40));
    expect(await asyncCodeOf(parseImport(cut, "pw"))).toBe("corrupt-file");
  }, 20_000);

  it("a malformed payload under a correct key is corrupt-file without a cause", async () => {
    const bytes = await stratumEncrypted("pw", { nope: 1 });
    const err = await parseImport(encodeBinaryImport(bytes), "pw").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "corrupt-file" });
    expect((err as Error).cause).toBeUndefined();
  }, 20_000);

  it("decrypts the legacy CBC form; a wrong password is wrong-password", async () => {
    const text = encodeBinaryImport(stratumLegacy("pw"));
    expect(await parseImport(text)).toEqual({ status: "needs-password", format: "stratum" });
    const out = await okResult(text, "pw");
    expect(out.result.accounts).toHaveLength(4);
    // CBC cannot authenticate: bad padding or non-JSON output both mean a wrong password.
    expect(await asyncCodeOf(parseImport(text, "other"))).toBe("wrong-password");
    const cut = encodeBinaryImport(stratumLegacy("pw").subarray(0, 40));
    expect(await asyncCodeOf(parseImport(cut, "pw"))).toBe("corrupt-file");
  });
});
