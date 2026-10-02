import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "../src/background/settings";
import { VaultService } from "../src/background/vaultService";
import { PASSWORD, unlockedService } from "./helpers/service";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const DAY = 86_400_000;

describe("backup reminder settings lifecycle", () => {
  it("restarts the clock when the first-seen date came from a clock that ran ahead", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: A });
    await saveSettings(p.local, { backupReminderSince: p.clock.now() + 400 * DAY });
    const before = p.clock.now();
    await service.getState();
    expect((await loadSettings(p.local)).backupReminderSince).toBe(before);
    p.clock.advance(31 * DAY);
    expect((await service.getState()).backupReminder).toEqual({ daysSince: null });
  });

  it("ignores a lastBackupAt from a clock that ran ahead without rewriting it", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: A });
    const future = p.clock.now() + 400 * DAY;
    await saveSettings(p.local, { lastBackupAt: future });
    await service.getState();
    expect((await loadSettings(p.local)).lastBackupAt).toBe(future);
    p.clock.advance(31 * DAY);
    expect((await service.getState()).backupReminder).toEqual({ daysSince: null });
  });

  it("setup of a new vault clears an old lastBackupAt and reminder dates", async () => {
    const { service, p } = await unlockedService();
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    await saveSettings(p.local, {
      lastBackupAt: p.clock.now() - 90 * DAY,
      backupReminderSince: p.clock.now() - 90 * DAY,
      backupReminderSnoozedUntil: p.clock.now() + DAY,
    });
    await service.quarantineVault();
    await saveSettings(p.local, { lastBackupAt: p.clock.now() - 90 * DAY });
    await new VaultService(p).setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    const s = await loadSettings(p.local);
    expect(s.lastBackupAt).toBeNull();
    expect(s.backupReminderSince).toBeNull();
    expect(s.backupReminderSnoozedUntil).toBeNull();
  });

  it("quarantineVault resets the first-seen date and the snooze", async () => {
    const { service, p } = await unlockedService();
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    await saveSettings(p.local, {
      backupReminderSince: p.clock.now() - 90 * DAY,
      backupReminderSnoozedUntil: p.clock.now() + DAY,
    });
    await service.quarantineVault();
    const s = await loadSettings(p.local);
    expect(s.backupReminderSince).toBeNull();
    expect(s.backupReminderSnoozedUntil).toBeNull();
  });

  it("a file export clears the snooze", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: A });
    await service.dismissBackupReminder();
    expect((await loadSettings(p.local)).backupReminderSnoozedUntil).not.toBeNull();
    const { token } = await service.reauth(PASSWORD);
    await service.exportVault(token, "otpauth");
    const s = await loadSettings(p.local);
    expect(s.backupReminderSnoozedUntil).toBeNull();
    expect(s.lastBackupAt).toBe(p.clock.now());
  });
});
