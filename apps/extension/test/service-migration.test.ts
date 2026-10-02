import { parseGoogleMigrationUri } from "@claviger/core";
import { describe, expect, it } from "vitest";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const S2 = "GEZDGNBVGY3TQOJQ";
const S3 = "MFRGGZDFMZTWQ2LK";

async function seeded() {
  const ctx = await unlockedService();
  await ctx.service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub` });
  await ctx.service.addAccount({ uri: `otpauth://totp/Seven:me?secret=${S2}&digits=7` });
  await ctx.service.addAccount({ uri: `otpauth://totp/Bank:me?secret=${S3}&issuer=Bank` });
  const ids = (await ctx.service.listAccounts()).accounts.map((a) => a.id);
  return { ...ctx, ids };
}

const token = (s: { reauth(p: string): Promise<{ token: string }> }) =>
  s.reauth(PASSWORD).then((r) => r.token);

describe("exportMigration", () => {
  it("returns QR URIs and the excluded accounts, and spends the token", async () => {
    const { service, ids } = await seeded();
    const t = await token(service);
    const out = await service.exportMigration(t, ids);
    expect(out.skipped).toEqual([{ name: "Seven: me", reason: "digits-unsupported" }]);
    const labels = out.uris.flatMap((u) =>
      parseGoogleMigrationUri(u).accounts.map((a) => a.issuer),
    );
    expect(labels).toEqual(["GitHub", "Bank"]);
    expect(await codeOf(service.exportMigration(t, ids))).toBe("invalid-token");
  });

  it("needs a token and an unlocked vault", async () => {
    const { service, ids } = await seeded();
    expect(await codeOf(service.exportMigration("nope", ids))).toBe("invalid-token");
    const t = await token(service);
    await service.lock();
    expect(await codeOf(service.exportMigration(t, ids))).toBe("locked");
  });

  it("refuses unknown ids instead of skipping them silently", async () => {
    const { service, ids } = await seeded();
    expect(await codeOf(service.exportMigration(await token(service), [ids[0]!, "ghost"]))).toBe(
      "not-found",
    );
  });

  it("is not a backup and persists nothing", async () => {
    const { service, ids, p } = await seeded();
    await service.exportMigration(await token(service), ids);
    expect((await service.getState()).lastBackupAt).toBeNull();
    for (const area of [p.local, p.session, p.sync]) {
      expect(JSON.stringify(await area.get())).not.toContain("otpauth-migration");
    }
  });
});
