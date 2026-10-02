import { describe, expect, it } from "vitest";
import { backupReminderFor } from "../src/background/backupReminder";
import { DEFAULT_SETTINGS } from "../src/background/settings";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const base = { ...DEFAULT_SETTINGS, backupReminderSince: NOW - 40 * DAY };

describe("backupReminderFor", () => {
  it("is null for an empty or unknown vault and when off", () => {
    expect(backupReminderFor(base, 0, NOW)).toBeNull();
    expect(backupReminderFor(base, null, NOW)).toBeNull();
    expect(backupReminderFor({ ...base, backupReminderDays: 0 }, 3, NOW)).toBeNull();
  });

  it("counts from the first-seen date when never backed up", () => {
    expect(backupReminderFor({ ...base, backupReminderSince: NOW - 29 * DAY }, 1, NOW)).toBeNull();
    expect(backupReminderFor({ ...base, backupReminderSince: NOW - 30 * DAY }, 1, NOW)).toEqual({
      daysSince: null,
    });
  });

  it("prefers lastBackupAt and reports whole days", () => {
    const s = { ...base, lastBackupAt: NOW - 45 * DAY - 5 };
    expect(backupReminderFor(s, 1, NOW)).toEqual({ daysSince: 45 });
  });

  it("is null without any base date", () => {
    expect(backupReminderFor({ ...base, backupReminderSince: null }, 1, NOW)).toBeNull();
  });

  it("is quiet while snoozed, and ignores a snooze set implausibly far ahead", () => {
    expect(
      backupReminderFor({ ...base, backupReminderSnoozedUntil: NOW + DAY }, 1, NOW),
    ).toBeNull();
    expect(
      backupReminderFor({ ...base, backupReminderSnoozedUntil: NOW + 7 * DAY }, 1, NOW),
    ).toBeNull();
    expect(
      backupReminderFor({ ...base, backupReminderSnoozedUntil: NOW + 7 * DAY + 1 }, 1, NOW),
    ).toEqual({ daysSince: null });
  });

  it("is null when the clock is behind the base date", () => {
    expect(backupReminderFor({ ...base, lastBackupAt: NOW + DAY }, 1, NOW)).toBeNull();
    expect(backupReminderFor({ ...base, backupReminderSince: NOW + DAY }, 1, NOW)).toBeNull();
  });
});
