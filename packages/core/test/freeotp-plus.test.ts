import { describe, expect, it } from "vitest";
import { parseImport } from "../src/importers";
import { aegisPlain } from "./helpers/aegis";
import { freeotpPlus, FREEOTP_SECRETS } from "./helpers/freeotp";
import { plainBackup } from "./helpers/upstream";

describe("FreeOTP+ import", () => {
  it("maps signed byte secrets to base32 and picks issuer/steam", async () => {
    const out = await parseImport(JSON.stringify(freeotpPlus()));
    expect(out).toMatchObject({ status: "ok", format: "freeotp-plus" });
    if (out.status !== "ok") return;
    expect(out.result.issues).toEqual([]);
    expect(out.result.accounts.map((a) => [a.type, a.issuer, a.label, a.secret])).toEqual([
      ["totp", "Deno", "Mason", FREEOTP_SECRETS.a],
      ["hotp", "Internal", "James", FREEOTP_SECRETS.b],
      ["steam", "Steam", "Sophia", FREEOTP_SECRETS.a],
    ]);
    expect(out.result.accounts[1]).toMatchObject({ counter: 5, algorithm: "SHA256", digits: 8 });
  });

  it("reports out-of-range secrets and MOTP without dropping silently", async () => {
    const file = freeotpPlus();
    const base = file.tokens[0] as Record<string, unknown>;
    file.tokens.push(
      { ...base, secret: [1, 256] },
      { ...base, secret: [-129] },
      { ...base, type: "MOTP" },
    );
    const out = await parseImport(JSON.stringify(file));
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.result.accounts).toHaveLength(3);
    expect(out.result.issues.map((i) => [i.position, i.reason])).toEqual([
      [3, "malformed-entry"],
      [4, "malformed-entry"],
      [5, "unsupported-type"],
    ]);
  });

  it("does not claim other JSON formats", async () => {
    for (const other of [aegisPlain(), plainBackup()]) {
      const out = await parseImport(JSON.stringify(other));
      expect(out.status === "ok" ? out.format : out.status).not.toBe("freeotp-plus");
    }
  });
});
