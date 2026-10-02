import { describe, expect, it } from "vitest";
import { parseImport } from "../src/importers";
import { encodeBinaryImport } from "../src/importers/binary";
import { ANDOTP_ENTRIES, andotpEncrypted } from "./helpers/andotp";
import { asyncCodeOf } from "./helpers/errors";

const header = (iterations: number, length = 60): Uint8Array => {
  const b = new Uint8Array(length);
  new DataView(b.buffer).setUint32(0, iterations, false);
  return b;
};

describe("andOTP import", () => {
  it("reads a plain array: types, counter, groups, MOTP reported", async () => {
    const out = await parseImport(JSON.stringify(ANDOTP_ENTRIES));
    expect(out).toMatchObject({ status: "ok", format: "andotp" });
    if (out.status !== "ok") return;
    expect(out.result.accounts.map((a) => [a.type, a.issuer, a.label])).toEqual([
      ["totp", "Deno", "Mason"],
      ["hotp", "Issuu", "James"],
      ["steam", "Steam", "Sophia"],
    ]);
    expect(out.result.accounts[1]).toMatchObject({ counter: 7 });
    expect(out.result.issues).toMatchObject([{ position: 3, reason: "unsupported-type" }]);
    expect(out.result.groupNames).toEqual(["Work", undefined, undefined]);
  });

  it("splits a legacy 'Issuer - account' label when issuer is missing", async () => {
    const { issuer: _i, ...legacy } = ANDOTP_ENTRIES[0]!;
    const out = await parseImport(JSON.stringify([{ ...legacy, label: "Acme - bob@x.io" }]));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts[0]).toMatchObject({ issuer: "Acme", label: "bob@x.io" });
  });

  it("reports a malformed entry beside a good one instead of rejecting the file", async () => {
    const out = await parseImport(JSON.stringify([ANDOTP_ENTRIES[0], { type: "TOTP" }]));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toHaveLength(1);
    expect(out.result.issues).toMatchObject([{ position: 1, reason: "malformed-entry" }]);
  });

  it("decrypts the binary form; wrong password and flipped byte are wrong-password", async () => {
    const bytes = await andotpEncrypted("pw");
    const text = encodeBinaryImport(bytes);
    expect(await parseImport(text)).toEqual({ status: "needs-password", format: "andotp" });
    const out = await parseImport(text, "pw");
    expect(out).toMatchObject({ status: "ok", format: "andotp" });
    expect(out.status === "ok" && out.result.accounts).toHaveLength(3);
    expect(out.status === "ok" && out.result.issues).toHaveLength(1);
    expect(await asyncCodeOf(parseImport(text, "other"))).toBe("wrong-password");
    const flipped = bytes.slice();
    flipped[flipped.length - 1]! ^= 1;
    // GCM cannot tell a wrong key from a flipped bit.
    expect(await asyncCodeOf(parseImport(encodeBinaryImport(flipped), "pw"))).toBe(
      "wrong-password",
    );
  });

  it("rejects absurd or tiny iteration counts without running the KDF", async () => {
    for (const n of [10_000_001, 0, 999]) {
      const started = performance.now();
      const code = await asyncCodeOf(parseImport(encodeBinaryImport(header(n)), "pw"));
      expect(code).toBe("corrupt-file");
      expect(performance.now() - started).toBeLessThan(500);
    }
    expect(await parseImport(encodeBinaryImport(header(1000, 40)), "pw")).toEqual({
      status: "unrecognized",
    });
  });

  it("bad or oversized binary is corrupt-file", async () => {
    expect(await asyncCodeOf(parseImport("claviger-binary:!!!"))).toBe("corrupt-file");
    expect(await asyncCodeOf(parseImport(encodeBinaryImport(new Uint8Array(3_800_000))))).toBe(
      "corrupt-file",
    );
  });

  it("rejects more than 10 000 entries and does not claim arbitrary arrays", async () => {
    const many = Array.from({ length: 10_001 }, () => ANDOTP_ENTRIES[0]);
    expect(await asyncCodeOf(parseImport(JSON.stringify(many)))).toBe("unsupported-format");
    expect(await parseImport("[1,2]")).toEqual({ status: "unrecognized" });
    expect(await parseImport("[]")).toEqual({ status: "unrecognized" });
  });
});
