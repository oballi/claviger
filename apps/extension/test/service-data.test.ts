import { generateCode, Vault } from "@claviger/core";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_TTL_MS,
  SYNC_ITEM_QUOTA_BYTES,
  SYNC_QUOTA_BYTES,
  VaultService,
} from "../src/background/vaultService";
import { pauseOnce } from "./helpers/pause";
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
      ungrouped: 0,
    });
    expect((await service.listAccounts()).accounts.map((a) => a.issuer)).toEqual(["", "Bank"]);
    expect(await codeOf(service.importCommit(preview.previewId, [1]))).toBe("preview-expired");
  });

  it("asks for a password or reports an unknown format", async () => {
    const { service } = await unlockedService();
    const exported = await service.exportVault(
      (await service.reauth(PASSWORD)).token,
      "claviger",
      "export password",
    );
    expect(await service.importPreview(exported.content)).toEqual({
      status: "needs-password",
      format: "claviger",
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
    await service.setClockCheckEnabled(true);
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

  it("refuses a sample whose end is before its start", async () => {
    const { service } = await unlockedService();
    await service.setClockCheckEnabled(true);
    const sample = { serverDate: new Date(0).toUTCString(), startMs: 2000, endMs: 1000 };
    expect(await codeOf(service.applyClockSample(sample))).toBe("invalid-request");
    expect((await service.getState()).clockOffsetSec).toBe(0);
  });

  it("refuses a sample that took longer than 10 seconds", async () => {
    const { service } = await unlockedService();
    await service.setClockCheckEnabled(true);
    const slow = { serverDate: new Date(0).toUTCString(), startMs: 0, endMs: 10_001 };
    expect(await codeOf(service.applyClockSample(slow))).toBe("invalid-request");
    const ok = { ...slow, endMs: 10_000 };
    expect((await service.applyClockSample(ok)).offsetSec).toBe(-5);
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

const hasVaultKey = (arg: unknown) =>
  Array.isArray(arg) ? arg.some((k) => String(k).startsWith("vault:")) : arg === undefined;
const removesVault = (arg: unknown) =>
  Array.isArray(arg) && arg.some((k) => String(k).startsWith("vault:"));
const setsVault = (arg: unknown) =>
  typeof arg === "object" && arg !== null && Object.keys(arg).some((k) => k.startsWith("vault:"));

describe("races (fix round 1)", () => {
  it("serializes parallel wrong-password reauth attempts through the throttle", async () => {
    const { service } = await unlockedService();
    const codes = await Promise.all(
      Array.from({ length: 10 }, () => codeOf(service.reauth("wrong password"))),
    );
    expect(codes.filter((c) => c === "wrong-password")).toHaveLength(3);
    expect(codes.filter((c) => c === "throttled")).toHaveLength(7);
  });

  it("keeps a lock that lands during a storage move", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ draft: { secret: SECRET } });
    const { token } = await service.reauth(PASSWORD);
    const g = pauseOnce(p.sync, "set", setsVault);
    const move = service.setStorageArea(token, "sync");
    await g.hit;
    await service.lock();
    g.release();
    await move;
    expect((await service.getState()).status).toBe("locked");
    expect(await Vault.exists(p.sync)).toBe(true);
    await service.unlock(PASSWORD);
    expect((await service.listAccounts()).accounts).toHaveLength(1);
  });

  it("never hands out a token minted across a lock", async () => {
    const { p, service } = await unlockedService();
    const g = pauseOnce(p.local, "get", (a) => Array.isArray(a) && a.includes("lock:attempts"));
    const pending = service.reauth(PASSWORD).then(
      (r) => r.token,
      () => null,
    );
    await g.hit;
    await service.lock();
    g.release();
    const token = await pending;
    await service.unlock(PASSWORD);
    expect(token).toBeNull();
  });

  it("rejects a token that was in flight while the vault was deleted and recreated", async () => {
    const { p, service } = await unlockedService();
    const first = (await service.reauth(PASSWORD)).token;
    const g = pauseOnce(p.local, "get", (a) => Array.isArray(a) && a.includes("lock:attempts"));
    const pending = service.reauth(PASSWORD).then(
      (r) => r.token,
      () => null,
    );
    await g.hit;
    const del = service.deleteVault(first);
    const setup = del.then(() =>
      service.setup({
        password: "another long password",
        createRecoveryCode: false,
        lockPolicy: { kind: "browser-close" },
        storageArea: "local",
      }),
    );
    g.release();
    const stale = await pending;
    await setup;
    // reauth is queued ahead of the delete, so it mints a token; the delete must then revoke it.
    expect(stale).not.toBeNull();
    expect(await codeOf(service.exportVault(stale!, "otpauth"))).toBe("invalid-token");
  });

  it("does not store a preview built across a lock", async () => {
    const { p, service } = await unlockedService();
    const g = pauseOnce(p.local, "get", hasVaultKey);
    const pending = service.importPreview(text).then(
      (r) => r,
      (e: { code?: string }) => e.code,
    );
    await g.hit;
    await service.lock();
    g.release();
    const outcome = await pending;
    await service.unlock(PASSWORD);
    expect(outcome).toBe("locked");
  });

  it("keeps a recovery code created during a move", async () => {
    const { p, service } = await unlockedService();
    const a = (await service.reauth(PASSWORD)).token;
    const b = (await service.reauth(PASSWORD)).token;
    const g = pauseOnce(p.local, "remove", removesVault);
    const move = service.setStorageArea(a, "sync");
    await g.hit;
    const code = service.createRecoveryCode(b);
    g.release();
    await move;
    const { recoveryCode } = await code;
    await service.lock();
    await service.unlockWithRecovery(recoveryCode, "brand new password");
    await service.lock();
    await service.unlock("brand new password");
  });

  it("keeps a password change made during a move", async () => {
    const { p, service } = await unlockedService();
    const a = (await service.reauth(PASSWORD)).token;
    const b = (await service.reauth(PASSWORD)).token;
    const g = pauseOnce(p.local, "remove", removesVault);
    const move = service.setStorageArea(a, "sync");
    await g.hit;
    const change = service.changePassword(b, "changed during move");
    g.release();
    await Promise.all([move, change]);
    await service.lock();
    await service.unlock("changed during move");
  });

  it("keeps only the newest import preview", async () => {
    const { service } = await unlockedService();
    const first = await service.importPreview(text);
    const second = await service.importPreview(text);
    if (first.status !== "ok" || second.status !== "ok") throw new Error("unexpected");
    expect(await codeOf(service.importCommit(first.previewId, [0]))).toBe("preview-expired");
    expect(await service.importCommit(second.previewId, [1])).toEqual({
      added: 1,
      duplicates: 0,
      ungrouped: 0,
    });
  });

  it("rejects clock samples while the check is off or when the offset is implausible", async () => {
    const { service } = await unlockedService();
    const sample = (sec: number) => ({
      serverDate: new Date(sec * 1000).toUTCString(),
      startMs: 0,
      endMs: 0,
    });
    expect(await codeOf(service.applyClockSample(sample(120)))).toBe("invalid-request");
    await service.setClockCheckEnabled(true);
    expect(await codeOf(service.applyClockSample(sample(43_201)))).toBe("invalid-request");
    expect(await service.applyClockSample(sample(43_200))).toEqual({
      offsetSec: 43_200,
      applied: 43_200,
    });
  });

  it("keeps the vault usable when a storage move fails", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ draft: { secret: SECRET, issuer: "A" } });
    const failing = p.sync as unknown as { set: () => Promise<void> };
    failing.set = () => Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
    const { token } = await service.reauth(PASSWORD);
    await expect(service.setStorageArea(token, "sync")).rejects.toThrow();
    expect((await service.getState()).storageArea).toBe("local");
    expect(await Vault.exists(p.local)).toBe(true);
    expect([...p.sync.data.keys()].some((k) => k.startsWith("vault:"))).toBe(false);
    expect((await service.listAccounts()).accounts.map((a) => a.issuer)).toEqual(["A"]);
    await service.addAccount({ draft: { secret: OTHER } });
  });
});

describe("groups in backups", () => {
  it("round-trips group names, order and membership through an .claviger file", async () => {
    const a = await unlockedService();
    const x = await a.service.addAccount({ draft: { secret: SECRET, issuer: "GitHub" } });
    await a.service.addAccount({ draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "Bank" } });
    await a.service.createGroup("Work");
    const home = await a.service.createGroup("Home");
    await a.service.setAccountGroup(x.id, home.id);
    await a.service.createGroup("Empty");
    const exported = await a.service.exportVault(
      (await a.service.reauth(PASSWORD)).token,
      "claviger",
      "export password",
    );
    const b = await unlockedService();
    await b.service.createGroup("home");
    const preview = await b.service.importPreview(exported.content, "export password");
    if (preview.status !== "ok") throw new Error("unexpected");
    expect(preview.items.map((i) => i.groupName)).toEqual(["Home", undefined]);
    expect(await b.service.importCommit(preview.previewId, [0, 1])).toEqual({
      added: 2,
      duplicates: 0,
      ungrouped: 0,
    });
    const listing = await b.service.listAccounts();
    expect(listing.groups.map((g) => g.name)).toEqual(["home"]);
    expect(listing.accounts.find((i) => i.issuer === "GitHub")!.groupId).toBe(
      listing.groups[0]!.id,
    );
    expect(listing.accounts.find((i) => i.issuer === "Bank")!.groupId).toBeNull();
  });

  it("leaves the plaintext otpauth export without groups", async () => {
    const { service } = await unlockedService();
    const g = await service.createGroup("Work");
    const { id } = await service.addAccount({ draft: { secret: SECRET, issuer: "GitHub" } });
    await service.setAccountGroup(id, g.id);
    const out = await service.exportVault((await service.reauth(PASSWORD)).token, "otpauth");
    expect(out.content).not.toContain("Work");
  });
});
