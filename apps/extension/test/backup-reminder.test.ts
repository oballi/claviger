import { describe, expect, it } from "vitest";
import { backupReminderFor, needsReminderStamp } from "../src/background/backupReminder";
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

  it("ignores a base date from a clock that ran ahead", () => {
    // lastBackupAt far in the future: fall back to the first-seen date.
    expect(
      backupReminderFor(
        { ...base, lastBackupAt: NOW + 2 * DAY, backupReminderSince: NOW - 40 * DAY },
        1,
        NOW,
      ),
    ).toEqual({ daysSince: null });
    // since far in the future counts as now: nothing due yet.
    expect(backupReminderFor({ ...base, backupReminderSince: NOW + 2 * DAY }, 1, NOW)).toBeNull();
    // within a day of skew a real date is still honoured.
    expect(backupReminderFor({ ...base, lastBackupAt: NOW + DAY }, 1, NOW)).toBeNull();
  });

  it("needsReminderStamp restarts the clock only without a sane base", () => {
    expect(needsReminderStamp({ ...DEFAULT_SETTINGS }, NOW)).toBe(true);
    expect(needsReminderStamp({ ...base }, NOW)).toBe(false);
    expect(needsReminderStamp({ ...base, backupReminderSince: NOW + 2 * DAY }, NOW)).toBe(true);
    expect(needsReminderStamp({ ...base, backupReminderSince: NOW + DAY }, NOW)).toBe(false);
    expect(needsReminderStamp({ ...DEFAULT_SETTINGS, lastBackupAt: NOW + 2 * DAY }, NOW)).toBe(
      true,
    );
    expect(needsReminderStamp({ ...DEFAULT_SETTINGS, lastBackupAt: NOW - DAY }, NOW)).toBe(false);
  });
});
