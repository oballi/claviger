import { generateCode, Vault } from "@otp-vault/core";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_TTL_MS,
  SYNC_ITEM_QUOTA_BYTES,
  SYNC_QUOTA_BYTES,
  VaultService,
} from "../src/background/vaultService";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const OTHER = "GEZDGNBVGY3TQOJQ";
const text = [
  `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
  `otpauth://totp/Bank:me?secret=${OTHER}&issuer=Bank`,
  "otpauth://motp/Old:me?secret=MFRGGZDFMZTWQ2LK",
].join("\n");

describe("import", () => {
  it("previews without secrets, marking duplicates and issues, then commits the chosen rows", async () => {
    const { service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/x?secret=${SECRET}` });
    const preview = await service.importPreview(text);
    expect(preview).toMatchObject({
      status: "ok",
      format: "otpauth",
      items: [
        { index: 0, issuer: "GitHub", label: "me", type: "totp", status: "duplicate" },
        { index: 1, issuer: "Bank", label: "me", type: "totp", status: "new" },
      ],
      issues: [expect.objectContaining({ position: 2, reason: "unsupported-type" })],
    });
    expect(JSON.stringify(preview)).not.toContain(SECRET);
    if (preview.status !== "ok") throw new Error("unexpected");
    expect(await service.importCommit(preview.previewId, [1, 1, 7, -1])).toEqual({
      added: 1,
      duplicates: 0,
    });
    expect((await service.listAccounts()).accounts.map((a) => a.issuer)).toEqual(["", "Bank"]);
    expect(await codeOf(service.importCommit(preview.previewId, [1]))).toBe("preview-expired");
  });

  it("asks for a password or reports an unknown format", async () => {
    const { service } = await unlockedService();
    const exported = await service.exportVault(
      (await service.reauth(PASSWORD)).token,
      "otpvault",
      "export password",
    );
    expect(await service.importPreview(exported.content)).toEqual({
      status: "needs-password",
      format: "otp-vault",
    });
    expect(await service.importPreview("hello")).toEqual({ status: "unrecognized" });
    expect(await codeOf(service.importPreview(exported.content, "wrong password"))).toBe(
      "wrong-password",
    );
  });

  it("expires previews after ten minutes and on lock", async () => {
    const { p, service } = await unlockedService();
    const first = await service.importPreview(text);
    if (first.status !== "ok") throw new Error("unexpected");
    p.clock.advance(PREVIEW_TTL_MS + 1);
    expect(await codeOf(service.importCommit(first.previewId, [0]))).toBe("preview-expired");
    const second = await service.importPreview(text);
    if (second.status !== "ok") throw new Error("unexpected");
    await service.lock();
    await service.unlock(PASSWORD);
    expect(await codeOf(service.importCommit(second.previewId, [0]))).toBe("preview-expired");
  });
});

describe("storage area", () => {
  it("does not lose writes that race with a storage move", async () => {
    const { service } = await unlockedService();
    const { id } = await service.addAccount({
      uri: `otpauth://hotp/Bank:me?secret=${SECRET}&counter=0`,
    });
    const { token } = await service.reauth(PASSWORD);
    await Promise.all([
      service.setStorageArea(token, "sync"),
      service.nextHotp(id),
      service.nextHotp(id),
    ]);
    const expected = await generateCode(
      { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 2 },
      0,
    );
    expect((await service.listAccounts()).accounts[0]!.code).toBe(expected.code);
  });

  it("moves the vault to sync and back, keeping it usable", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ draft: { secret: SECRET, issuer: "A" } });
    await service.setStorageArea((await service.reauth(PASSWORD)).token, "sync");
    expect(await Vault.exists(p.sync)).toBe(true);
    expect([...p.local.data.keys()].some((k) => k.startsWith("vault:"))).toBe(false);
    expect((await service.getState()).storageArea).toBe("sync");
    expect((await service.listAccounts()).accounts.map((a) => a.issuer)).toEqual(["A"]);
    expect((await new VaultService(p).listAccounts()).accounts).toHaveLength(1);
    await service.setStorageArea((await service.reauth(PASSWORD)).token, "sync");
    await service.setStorageArea((await service.reauth(PASSWORD)).token, "local");
    expect(await Vault.exists(p.local)).toBe(true);
    expect(await Vault.exists(p.sync)).toBe(false);
  });

  it("reports storage usage with sync quotas", async () => {
    const { service } = await unlockedService();
    await service.addAccount({ draft: { secret: SECRET } });
    const local = await service.storageUsage();
    expect(local).toMatchObject({ area: "local", quotaBytes: null, maxItemBytes: null });
    expect(local.bytes).toBeGreaterThan(local.indexBytes);
    expect(local.indexBytes).toBeGreaterThan(0);
    await service.setStorageArea((await service.reauth(PASSWORD)).token, "sync");
    expect(await service.storageUsage()).toMatchObject({
      area: "sync",
      quotaBytes: SYNC_QUOTA_BYTES,
      maxItemBytes: SYNC_ITEM_QUOTA_BYTES,
    });
  });
});

describe("clock", () => {
  it("applies offsets larger than 30 seconds and ignores small ones", async () => {
    const { service } = await unlockedService();
    const at = (iso: string) => ({
      serverDate: new Date(iso).toUTCString(),
      startMs: Date.parse("2026-01-01T00:00:00Z"),
      endMs: Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(await service.applyClockSample(at("2026-01-01T00:01:00Z"))).toEqual({
      offsetSec: 60,
      applied: 60,
    });
    expect((await service.getState()).clockOffsetSec).toBe(60);
    expect(await service.applyClockSample(at("2026-01-01T00:00:10Z"))).toEqual({
      offsetSec: 10,
      applied: 0,
    });
    expect((await service.getState()).clockOffsetSec).toBe(0);
    expect(
      await codeOf(service.applyClockSample({ serverDate: "nonsense", startMs: 0, endMs: 0 })),
    ).toBe("invalid-request");
  });

  it("toggles the clock check and clears the offset when turned off", async () => {
    const { service } = await unlockedService();
    await service.setClockCheckEnabled(true);
    await service.applyClockSample({
      serverDate: new Date(120_000).toUTCString(),
      startMs: 0,
      endMs: 0,
    });
    expect(await service.getState()).toMatchObject({
      clockCheckEnabled: true,
      clockOffsetSec: 120,
    });
    await service.setClockCheckEnabled(false);
    expect(await service.getState()).toMatchObject({ clockCheckEnabled: false, clockOffsetSec: 0 });
  });
});
