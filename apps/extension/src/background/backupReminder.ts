import type { Settings } from "./settings";

const DAY_MS = 86_400_000;
export const SNOOZE_DAYS = 7;

type ReminderInput = Pick<
  Settings,
  "backupReminderDays" | "lastBackupAt" | "backupReminderSince" | "backupReminderSnoozedUntil"
>;

/** Pure: null means "show nothing". A clock behind the base date also yields null. */
export function backupReminderFor(
  s: ReminderInput,
  accountCount: number | null,
  now: number,
): { daysSince: number | null } | null {
  if (!accountCount || s.backupReminderDays === 0) return null;
  // A snooze further out than we ever write is clock skew or damage; it must not silence the reminder.
  const until = s.backupReminderSnoozedUntil;
  if (until !== null && until <= now + SNOOZE_DAYS * DAY_MS && now < until) return null;
  const base = s.lastBackupAt ?? s.backupReminderSince;
  if (base === null) return null;
  const elapsedDays = Math.floor((now - base) / DAY_MS);
  if (elapsedDays < s.backupReminderDays) return null;
  return { daysSince: s.lastBackupAt === null ? null : elapsedDays };
}
