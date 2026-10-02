import type { Settings } from "./settings";

const DAY_MS = 86_400_000;
export const SNOOZE_DAYS = 7;

type ReminderInput = Pick<
  Settings,
  "backupReminderDays" | "lastBackupAt" | "backupReminderSince" | "backupReminderSnoozedUntil"
>;

/** Pure: null means "show nothing". A base date from a clock that ran ahead is ignored. */
export function backupReminderFor(
  s: ReminderInput,
  accountCount: number | null,
  now: number,
): { daysSince: number | null } | null {
  if (!accountCount || s.backupReminderDays === 0) return null;
  // A snooze further out than we ever write is clock skew or damage; it must not silence the reminder.
  const until = s.backupReminderSnoozedUntil;
  if (until !== null && until <= now + SNOOZE_DAYS * DAY_MS && now < until) return null;
  const last = usableLastBackup(s, now);
  const base =
    last ?? (s.backupReminderSince === null ? null : Math.min(s.backupReminderSince, now));
  if (base === null) return null;
  const elapsedDays = Math.floor((now - base) / DAY_MS);
  if (elapsedDays < s.backupReminderDays) return null;
  return { daysSince: last === null ? null : elapsedDays };
}

// A date more than a day ahead means the clock was ahead when it was written; such a base would
// silence the reminder for as long as the skew, so it is ignored (never rewritten).
function usableLastBackup(s: ReminderInput, now: number): number | null {
  return s.lastBackupAt !== null && s.lastBackupAt <= now + DAY_MS ? s.lastBackupAt : null;
}

/** True when the first-seen clock must be (re)started: no usable backup date and no sane since date. */
export function needsReminderStamp(s: ReminderInput, now: number): boolean {
  if (usableLastBackup(s, now) !== null) return false;
  return s.backupReminderSince === null || s.backupReminderSince > now + DAY_MS;
}
