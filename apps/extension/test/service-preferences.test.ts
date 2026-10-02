import { describe, expect, it } from "vitest";
import { CLIPBOARD_ALARM, VaultService } from "../src/background/vaultService";
import { memoryPlatform } from "./helpers/platform";
import { PASSWORD, unlockedService } from "./helpers/service";

describe("view mode", () => {
  it("defaults to normal and persists a change", async () => {
    const { service } = await unlockedService();
    expect((await service.getState()).viewMode).toBe("normal");
    await service.setViewMode("hidden");
    expect((await service.getState()).viewMode).toBe("hidden");
  });
});

describe("language", () => {
  it("defaults to system and persists a change, also while locked", async () => {
    const { service } = await unlockedService();
    expect((await service.getState()).language).toBe("system");
    await service.setLanguage("tr");
    await service.lock();
    expect((await service.getState()).language).toBe("tr");
  });
});

describe("clipboard clearing", () => {
  it("does nothing while the setting is off", async () => {
    const { service, p } = await unlockedService();
    await service.clipboardCopied();
    expect(p.alarms.scheduled.has(CLIPBOARD_ALARM)).toBe(false);
  });

  it("schedules a clear and restarts it on every copy", async () => {
    const { service, p } = await unlockedService();
    await service.setClipboardClear(30);
    await service.clipboardCopied();
    const first = p.alarms.scheduled.get(CLIPBOARD_ALARM)!;
    expect(first).toBe(p.clock.now() + 30_000);
    p.clock.advance(10_000);
    await service.clipboardCopied();
    expect(p.alarms.scheduled.get(CLIPBOARD_ALARM)).toBe(p.clock.now() + 30_000);
    await service.handleAlarm(CLIPBOARD_ALARM);
    expect(p.clipboard.clears).toBe(1);
  });

  it("reads the setting when the alarm fires", async () => {
    const { service, p } = await unlockedService();
    await service.setClipboardClear(60);
    await service.clipboardCopied();
    await service.setClipboardClear(0);
    expect(p.alarms.scheduled.has(CLIPBOARD_ALARM)).toBe(false);
    await service.handleAlarm(CLIPBOARD_ALARM);
    expect(p.clipboard.clears).toBe(0);
  });

  it("works while locked", async () => {
    const { service, p } = await unlockedService();
    await service.setClipboardClear(30);
    await service.lock();
    await service.clipboardCopied();
    await service.handleAlarm(CLIPBOARD_ALARM);
    expect(p.clipboard.clears).toBe(1);
  });
});

describe("recovery code confirmation", () => {
  it("is unconfirmed after setup with a code until confirmed", async () => {
    const { service } = await unlockedService();
    expect((await service.getState()).recoveryCodeConfirmed).toBe(false);
    await service.confirmRecoveryCode();
    expect((await service.getState()).recoveryCodeConfirmed).toBe(true);
  });

  it("stays confirmed after setup without a code", async () => {
    const service = new VaultService(memoryPlatform());
    await service.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect((await service.getState()).recoveryCodeConfirmed).toBe(true);
  });

  it("is unconfirmed again after a new code", async () => {
    const { service } = await unlockedService();
    await service.confirmRecoveryCode();
    const { token } = await service.reauth(PASSWORD);
    await service.createRecoveryCode(token);
    expect((await service.getState()).recoveryCodeConfirmed).toBe(false);
  });

  it("is unconfirmed again after a recovery unlock", async () => {
    const { service } = await unlockedService();
    const { token } = await service.reauth(PASSWORD);
    const { recoveryCode } = await service.createRecoveryCode(token);
    await service.confirmRecoveryCode();
    await service.lock();
    await service.unlockWithRecovery(recoveryCode, "another password 1");
    expect((await service.getState()).recoveryCodeConfirmed).toBe(false);
  });

  it("still returns a new recovery code when the unconfirmed flag cannot be saved", async () => {
    const { p, service } = await unlockedService();
    const realSet = p.local.set.bind(p.local);
    let failed = 0;
    p.local.set = async (items) => {
      const settings = items["settings"] as { recoveryCodeConfirmed?: boolean } | undefined;
      if (settings?.recoveryCodeConfirmed === false && failed === 0) {
        failed++;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      return realSet(items);
    };
    const { token } = await service.reauth(PASSWORD);
    const { recoveryCode } = await service.createRecoveryCode(token);
    expect(failed).toBe(1);
    await service.lock();
    const recovered = await service.unlockWithRecovery(recoveryCode, "another password 1");
    expect(recovered.recoveryCode).toBeTruthy();
    await service.lock();
    await service.unlock("another password 1");
  });

  it("still returns the replacement code after a recovery unlock when the flag cannot be saved", async () => {
    const { p, service, recoveryCode } = await unlockedService();
    await service.lock();
    const realSet = p.local.set.bind(p.local);
    let failed = 0;
    p.local.set = async (items) => {
      const settings = items["settings"] as { recoveryCodeConfirmed?: boolean } | undefined;
      if (settings?.recoveryCodeConfirmed === false && failed < 2) {
        failed++;
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      return realSet(items);
    };
    const result = await service.unlockWithRecovery(recoveryCode!, "another password 1");
    expect(failed).toBe(2);
    expect(result.recoveryCode).toBeTruthy();
  });
});

describe("backup reminder", () => {
  const DAY = 86_400_000;
  const add = (service: VaultService) =>
    service.addAccount({ uri: "otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&issuer=A" });
  const reminder = async (service: VaultService) => (await service.getState()).backupReminder;

  it("never shows for an empty vault or when off", async () => {
    const { service, p } = await unlockedService();
    expect((await service.getState()).backupReminderDays).toBe(30);
    p.clock.advance(31 * DAY);
    expect(await reminder(service)).toBeNull();
    await add(service);
    await service.getState();
    await service.setBackupReminder(0);
    p.clock.advance(60 * DAY);
    expect(await reminder(service)).toBeNull();
  });

  it("counts from the first account when never backed up", async () => {
    const { service, p } = await unlockedService();
    await add(service);
    expect(await reminder(service)).toBeNull();
    p.clock.advance(29 * DAY);
    expect(await reminder(service)).toBeNull();
    p.clock.advance(DAY);
    expect(await reminder(service)).toEqual({ daysSince: null });
    await service.setBackupReminder(90);
    expect(await reminder(service)).toBeNull();
  });

  it("is cleared by a file export and quiet for 7 days after dismissal", async () => {
    const { service, p } = await unlockedService();
    await add(service);
    await service.getState();
    p.clock.advance(31 * DAY);
    expect(await reminder(service)).toEqual({ daysSince: null });
    await service.dismissBackupReminder();
    expect(await reminder(service)).toBeNull();
    p.clock.advance(6 * DAY);
    expect(await reminder(service)).toBeNull();
    p.clock.advance(DAY);
    expect(await reminder(service)).toEqual({ daysSince: null });
    const { token } = await service.reauth(PASSWORD);
    await service.exportVault(token, "otpauth");
    expect(await reminder(service)).toBeNull();
    p.clock.advance(31 * DAY);
    expect(await reminder(service)).toEqual({ daysSince: 31 });
  });

  it.each([
    ["claviger", "other password 123"],
    ["aegis", "other password 123"],
    ["aegis-plain", undefined],
    ["otpauth", undefined],
  ] as const)("counts a %s export as a backup", async (format, pw) => {
    const { service } = await unlockedService();
    await add(service);
    const { token } = await service.reauth(PASSWORD);
    await service.exportVault(token, format, pw);
    expect((await service.getState()).lastBackupAt).not.toBeNull();
  });

  it("does not count a failed export or a migration export", async () => {
    const { service } = await unlockedService();
    await add(service);
    const { token } = await service.reauth(PASSWORD);
    await expect(service.exportVault(token, "aegis", PASSWORD)).rejects.toThrow();
    expect((await service.getState()).lastBackupAt).toBeNull();
    const t2 = (await service.reauth(PASSWORD)).token;
    await service.exportMigration(t2, []);
    expect((await service.getState()).lastBackupAt).toBeNull();
  });

  it("does not show when the clock moves backwards", async () => {
    const { service, p } = await unlockedService();
    await add(service);
    await service.getState();
    p.clock.advance(-DAY);
    expect(await reminder(service)).toBeNull();
    p.clock.advance(DAY + 29 * DAY);
    expect(await reminder(service)).toBeNull();
  });

  it("starts fresh for a new vault after a reset", async () => {
    const { service, p } = await unlockedService();
    await add(service);
    await service.getState();
    p.clock.advance(31 * DAY);
    expect(await reminder(service)).not.toBeNull();
    const { token } = await service.reauth(PASSWORD);
    await service.deleteVault(token);
    await service.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    await add(service);
    expect(await reminder(service)).toBeNull();
    p.clock.advance(29 * DAY);
    expect(await reminder(service)).toBeNull();
    p.clock.advance(DAY);
    expect(await reminder(service)).toEqual({ daysSince: null });
  });

  it("is not shown while locked", async () => {
    const { service, p } = await unlockedService();
    await add(service);
    await service.getState();
    p.clock.advance(40 * DAY);
    await service.lock();
    expect(await reminder(service)).toBeNull();
  });
});
