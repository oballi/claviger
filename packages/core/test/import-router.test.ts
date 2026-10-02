import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeAccountInput } from "../src/account/account";
import { isCoreError } from "../src/errors";
import { exportClaviger } from "../src/exporters/claviger";
import { parseImport } from "../src/importers";
import { buildImportPreview } from "../src/importers/preview";
import { aegisEncrypted, aegisPlain } from "./helpers/aegis";
import { asyncCodeOf } from "./helpers/errors";
import { migrationPayload, migrationUri, otpParameters } from "./helpers/protobuf";
import { twofasEncrypted, twofasPlain } from "./helpers/twofas";
import { plainBackup, v2Backup } from "./helpers/upstream";
import { makeDeps } from "./helpers/vault";

const json = (v: unknown) => JSON.stringify(v);

describe("parseImport", () => {
  it("routes otpauth text and Google migration links", async () => {
    expect(await parseImport("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP")).toMatchObject({
      status: "ok",
      format: "otpauth",
    });
    const migration = migrationUri(
      migrationPayload([otpParameters({ secret: new Uint8Array(10), name: "a" })]),
    );
    expect(await parseImport(`  ${migration}\n`)).toMatchObject({
      status: "ok",
      format: "google-migration",
    });
    expect(
      await parseImport(`${migration}\notpauth://totp/x?secret=JBSWY3DPEHPK3PXP`),
    ).toMatchObject({ format: "otpauth" });
  });

  it.each([
    ["aegis", () => json(aegisPlain())],
    ["2fas", () => json(twofasPlain())],
    ["upstream-authenticator", () => json(plainBackup())],
  ])("routes plain %s files", async (format, make) => {
    const outcome = await parseImport(make());
    expect(outcome).toMatchObject({ status: "ok", format });
  });

  it("asks for a password when needed and then decrypts", async () => {
    const files: [string, string, string][] = [
      ["aegis", json(aegisEncrypted("pw")), "pw"],
      ["2fas", json(twofasEncrypted("pw")), "pw"],
      ["upstream-authenticator", json(v2Backup("pw")), "pw"],
      [
        "claviger",
        await exportClaviger(
          [normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP" })],
          "pw",
          makeDeps(),
        ),
        "pw",
      ],
    ];
    for (const [format, text, password] of files) {
      expect(await parseImport(text)).toEqual({ status: "needs-password", format });
      const outcome = await parseImport(text, password);
      expect(outcome).toMatchObject({ status: "ok", format });
      expect(await asyncCodeOf(parseImport(text, "wrong"))).toBe("wrong-password");
    }
  });

  it("routes legacy otp-vault-export files to the claviger format", async () => {
    const exported = JSON.parse(
      await exportClaviger(
        [normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP" })],
        "pw",
        makeDeps(),
      ),
    );
    expect(await parseImport(json({ ...exported, format: "otp-vault-export" }))).toEqual({
      status: "needs-password",
      format: "claviger",
    });
  });

  it("checks specific formats before the generic upstream heuristic", async () => {
    // The upstream detector accepts any value with a "secret" field; specific formats must come first.
    const lookalike = { secret: "JBSWY3DPEHPK3PXP", type: "totp" };
    const exported = JSON.parse(
      await exportClaviger(
        [normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP" })],
        "pw",
        makeDeps(),
      ),
    );
    expect(await parseImport(json({ ...exported, extra: lookalike }))).toEqual({
      status: "needs-password",
      format: "claviger",
    });
    expect(await parseImport(json({ ...aegisPlain(), extra: lookalike }))).toMatchObject({
      status: "ok",
      format: "aegis",
    });
  });

  it.each(["", "hello", "{}", "[1,2,3]", json({ some: "object" }), "null"])(
    "does not recognize %j",
    async (text) => {
      expect(await parseImport(text)).toEqual({ status: "unrecognized" });
    },
  );

  it("never throws anything but CoreError on arbitrary JSON", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        try {
          await parseImport(JSON.stringify(value));
        } catch (e) {
          return isCoreError(e);
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });
});

describe("buildImportPreview", () => {
  it("marks duplicates against the vault and inside the batch", () => {
    const a = normalizeAccountInput({ secret: "JBSWY3DPEHPK3PXP", issuer: "A" });
    const b = normalizeAccountInput({ secret: "GEZDGNBVGY3TQOJQ", issuer: "B" });
    const preview = buildImportPreview(
      [a, b, { ...b, issuer: "B again" }],
      [{ type: "totp", secret: "jbsw y3dp ehpk 3pxp" }],
    );
    expect(preview.map((p) => p.status)).toEqual(["duplicate", "new", "duplicate"]);
  });
});
