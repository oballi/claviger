import { parseImport, parseOtpauthUri } from "@claviger/core";
import { describe, expect, it } from "vitest";
import { ATTEMPTS_KEY } from "../src/background/throttle";
import { PERSISTED_KEY } from "../src/background/keyCache";
import { AUTOLOCK_ALARM, TOKEN_TTL_MS } from "../src/background/vaultService";
import { memoryPlatform } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("reauth tokens", () => {
  it("issues single-use tokens that expire after 60 seconds", async () => {
    const { p, service } = await unlockedService();
    const { id } = await service.addAccount({
      uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
    });
    const { token } = await service.reauth(PASSWORD);
    const { uri } = await service.revealSecret(token, id);
    expect(parseOtpauthUri(uri)).toMatchObject({ secret: SECRET, issuer: "GitHub", label: "me" });
    expect(await codeOf(service.revealSecret(token, id))).toBe("invalid-token");
    const late = await service.reauth(PASSWORD);
    p.clock.advance(TOKEN_TTL_MS + 1);
    expect(await codeOf(service.revealSecret(late.token, id))).toBe("invalid-token");
    expect(await codeOf(service.revealSecret("made-up", id))).toBe("invalid-token");
  });

  it("rejects a wrong password and counts it towards the throttle", async () => {
    const { service } = await unlockedService();
    for (let i = 0; i < 3; i++)
      expect(await codeOf(service.reauth("wrong password"))).toBe("wrong-password");
    expect(await codeOf(service.reauth(PASSWORD))).toBe("throttled");
  });

  it("drops tokens when the vault locks", async () => {
    const { service } = await unlockedService();
    const { token } = await service.reauth(PASSWORD);
    await service.lock();
    await service.unlock(PASSWORD);
    expect(await codeOf(service.createRecoveryCode(token))).toBe("invalid-token");
  });
});

describe("credentials and policy", () => {
  it("changes the password", async () => {
    const { service } = await unlockedService();
    expect(
      await codeOf(service.changePassword((await service.reauth(PASSWORD)).token, "short")),
    ).toBe("invalid-request");
    await service.changePassword((await service.reauth(PASSWORD)).token, "a new long password");
    await service.lock();
    expect(await codeOf(service.unlock(PASSWORD))).toBe("wrong-password");
    await service.unlock("a new long password");
  });

  it("creates a new recovery code", async () => {
    const { service, recoveryCode } = await unlockedService();
    const { recoveryCode: next } = await service.createRecoveryCode(
      (await service.reauth(PASSWORD)).token,
    );
    expect(next).not.toBe(recoveryCode);
    expect((await service.getState()).hasRecoveryCode).toBe(true);
  });

  it("applies a new lock policy to the key cache and the autolock alarm", async () => {
    const { p, service } = await unlockedService();
    await service.setLockPolicy((await service.reauth(PASSWORD)).token, { kind: "never" });
    expect(p.local.data.has(PERSISTED_KEY)).toBe(true);
    expect((await service.getState()).lockPolicy).toEqual({ kind: "never" });
    await service.setLockPolicy((await service.reauth(PASSWORD)).token, {
      kind: "timeout",
      minutes: 60,
    });
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    expect(p.alarms.scheduled.get(AUTOLOCK_ALARM)).toBe(p.clock.now() + 60 * 60_000);
    await service.setLockPolicy((await service.reauth(PASSWORD)).token, { kind: "browser-close" });
    expect(p.alarms.scheduled.has(AUTOLOCK_ALARM)).toBe(false);
  });
});

describe("export", () => {
  it("dates the file by the user's local day, not the UTC day", async () => {
    const zone = process.env.TZ;
    // UTC+13: 12:00 UTC is already the next calendar day locally.
    process.env.TZ = "Pacific/Auckland";
    try {
      const { p, service } = await unlockedService();
      p.clock.ms = Date.UTC(2026, 0, 1, 12, 0, 0);
      const { token } = await service.reauth(PASSWORD);
      const { filename } = await service.exportVault(token, "otpauth");
      expect(filename).toBe("claviger-2026-01-02.txt");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("exports an encrypted .claviger file that imports back", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub` });
    expect(await codeOf(service.exportVault("unused", "claviger", "short"))).toBe(
      "invalid-request",
    );
    const { token } = await service.reauth(PASSWORD);
    const { filename, content } = await service.exportVault(token, "claviger", "export password");
    const d = new Date(p.clock.now());
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(filename).toBe(`claviger-${local}.claviger`);
    expect(content).not.toContain(SECRET);
    const parsed = await parseImport(content, "export password");
    expect(parsed).toMatchObject({ status: "ok", format: "claviger" });
  });

  it("exports plain otpauth text", async () => {
    const { service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub` });
    const { filename, content } = await service.exportVault(
      (await service.reauth(PASSWORD)).token,
      "otpauth",
    );
    expect(filename).toMatch(/\.txt$/);
    expect(content).toContain(`secret=${SECRET}`);
  });
});

describe("reveal without a password (setting)", () => {
  it("requires a token by default and reports the setting in the state", async () => {
    const { service } = await unlockedService();
    const { id } = await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}` });
    expect(await codeOf(service.revealSecret(undefined, id))).toBe("invalid-token");
    expect((await service.getState()).revealRequiresPassword).toBe(true);
  });

  it("allows reveal without a token once disabled, but still needs the vault unlocked", async () => {
    const { service } = await unlockedService();
    const { id } = await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}` });
    expect(await codeOf(service.setRevealRequiresPassword("made-up", false))).toBe("invalid-token");
    await service.setRevealRequiresPassword((await service.reauth(PASSWORD)).token, false);
    expect((await service.getState()).revealRequiresPassword).toBe(false);
    const { uri } = await service.revealSecret(undefined, id);
    expect(parseOtpauthUri(uri).secret).toBe(SECRET);
    // A token that is passed is still validated and spent.
    expect(await codeOf(service.revealSecret("made-up", id))).toBe("invalid-token");
    const { token } = await service.reauth(PASSWORD);
    await service.revealSecret(token, id);
    expect(await codeOf(service.revealSecret(token, id))).toBe("invalid-token");
    await service.lock();
    expect(await codeOf(service.revealSecret(undefined, id))).toBe("locked");
    await service.unlock(PASSWORD);
    await service.setRevealRequiresPassword((await service.reauth(PASSWORD)).token, true);
    expect(await codeOf(service.revealSecret(undefined, id))).toBe("invalid-token");
  });
});

describe("export result and backup time", () => {
  it("reports count and skipped records and stores lastBackupAt", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}` });
    await service.addAccount({ uri: `otpauth://totp/Bank:me?secret=GEZDGNBVGY3TQOJQ` });
    p.local.data.set("vault:acct:broken", "garbage");
    expect((await service.getState()).lastBackupAt).toBeNull();
    const out = await service.exportVault((await service.reauth(PASSWORD)).token, "otpauth");
    expect(out).toMatchObject({ count: 2, skipped: 1 });
    expect((await service.getState()).lastBackupAt).toBe(p.clock.now());
    p.clock.advance(5000);
    await service.exportVault(
      (await service.reauth(PASSWORD)).token,
      "claviger",
      "export password",
    );
    expect((await service.getState()).lastBackupAt).toBe(p.clock.now());
  });

  it("does not record a backup when the token is invalid", async () => {
    const { service } = await unlockedService();
    expect(await codeOf(service.exportVault("made-up", "otpauth"))).toBe("invalid-token");
    expect((await service.getState()).lastBackupAt).toBeNull();
  });
});

describe("delete vault", () => {
  it("wipes the active vault and lock keys, resets settings and allows a fresh setup", async () => {
    const { p, service } = await unlockedService(memoryPlatform(), { kind: "never" });
    await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}` });
    await service.setStorageArea((await service.reauth(PASSWORD)).token, "sync");
    p.sync.data.set("vault:stray", 1);
    p.local.data.set("vault:stray2", 1);
    p.local.data.set("unrelated", "keep-local");
    p.sync.data.set("unrelated", "keep-sync");
    for (let i = 0; i < 2; i++) await codeOf(service.reauth("wrong password"));
    expect(p.local.data.has(ATTEMPTS_KEY)).toBe(true);
    await service.deleteVault((await service.reauth(PASSWORD)).token);
    expect([...p.sync.data.keys()].filter((k) => k.startsWith("vault:"))).toEqual([]);
    // Only the active area (sync) is wiped; the inactive area is left alone.
    expect(p.local.data.get("vault:stray2")).toBe(1);
    for (const area of [p.local, p.session]) {
      expect([...area.data.keys()].filter((k) => k.startsWith("lock:"))).toEqual([]);
    }
    expect(p.alarms.scheduled.has(AUTOLOCK_ALARM)).toBe(false);
    expect(p.local.data.get("unrelated")).toBe("keep-local");
    expect(p.sync.data.get("unrelated")).toBe("keep-sync");
    expect(await service.getState()).toMatchObject({
      status: "no-vault",
      storageArea: "local",
      lockPolicy: { kind: "browser-close" },
    });
    await service.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect((await service.getState()).status).toBe("unlocked");
  });

  it("leaves a vault in the other storage area alone and adopts it", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/GitHub:me?secret=${SECRET}` });
    const other = await unlockedService(memoryPlatform());
    for (const [key, value] of other.p.local.data) {
      if (key.startsWith("vault:")) p.sync.data.set(key, structuredClone(value));
    }
    const syncKeys = [...p.sync.data.keys()].filter((k) => k.startsWith("vault:")).sort();
    await service.deleteVault((await service.reauth(PASSWORD)).token);
    expect([...p.local.data.keys()].filter((k) => k.startsWith("vault:"))).toEqual([]);
    expect([...p.sync.data.keys()].filter((k) => k.startsWith("vault:")).sort()).toEqual(syncKeys);
    expect(await service.getState()).toMatchObject({ status: "locked", storageArea: "sync" });
  });

  it("reports no vault after deleting a vault that only lived in sync", async () => {
    const { p, service } = await unlockedService();
    await service.setStorageArea((await service.reauth(PASSWORD)).token, "sync");
    await service.deleteVault((await service.reauth(PASSWORD)).token);
    for (const area of [p.local, p.sync]) {
      expect([...area.data.keys()].filter((k) => k.startsWith("vault:"))).toEqual([]);
    }
    expect((await service.getState()).status).toBe("no-vault");
  });

  it("deletes nothing without a valid token", async () => {
    const { p, service } = await unlockedService();
    expect(await codeOf(service.deleteVault("made-up"))).toBe("invalid-token");
    expect((await service.getState()).status).toBe("unlocked");
    expect([...p.local.data.keys()].some((k) => k.startsWith("vault:"))).toBe(true);
  });

  it("refuses vault access right after the deletion", async () => {
    const { service } = await unlockedService();
    const { token } = await service.reauth(PASSWORD);
    await service.deleteVault(token);
    expect(await codeOf(service.listAccounts())).toBe("locked");
  });
});

describe("serialized settings writes", () => {
  it("keeps concurrent settings updates from losing each other", async () => {
    const { service } = await unlockedService();
    const a = (await service.reauth(PASSWORD)).token;
    const b = (await service.reauth(PASSWORD)).token;
    await Promise.all([
      service.setLockPolicy(a, { kind: "timeout", minutes: 15 }),
      service.setRevealRequiresPassword(b, false),
      service.setClockCheckEnabled(true),
      service.applyClockSample({
        serverDate: new Date(120_000).toUTCString(),
        startMs: 0,
        endMs: 0,
      }),
    ]);
    expect(await service.getState()).toMatchObject({
      lockPolicy: { kind: "timeout", minutes: 15 },
      revealRequiresPassword: false,
      clockCheckEnabled: true,
      clockOffsetSec: 120,
    });
  });
});
