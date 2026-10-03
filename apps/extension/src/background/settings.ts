import "../zodConfig";
import type { StoragePort } from "@claviger/core";
import {
  backupReminderDaysSchema,
  clipboardClearSchema,
  languageSchema,
  lockPolicySchema,
  openModeSchema,
  popupSizeSchema,
  themeSchema,
  viewModeSchema,
  type BackupReminderDays,
  type ClipboardClearSec,
  type Language,
  type LockPolicy,
  type OpenMode,
  type PopupSize,
  type Theme,
  type ViewMode,
} from "@claviger/ui/protocol";
import { z } from "zod";

export const MAX_CLOCK_OFFSET_SEC = 12 * 3600;

export {
  backupReminderDaysSchema,
  clipboardClearSchema,
  languageSchema,
  lockPolicySchema,
  openModeSchema,
  popupSizeSchema,
  themeSchema,
  viewModeSchema,
};
export type {
  BackupReminderDays,
  ClipboardClearSec,
  Language,
  LockPolicy,
  OpenMode,
  PopupSize,
  Theme,
  ViewMode,
};

export const settingsSchema = z.object({
  // Display mirror and legacy migration input only; the sealed lock:policy record is authoritative.
  lockPolicy: lockPolicySchema,
  storageArea: z.enum(["local", "sync"]),
  clockOffsetSec: z.number().int().min(-MAX_CLOCK_OFFSET_SEC).max(MAX_CLOCK_OFFSET_SEC),
  clockCheckEnabled: z.boolean(),
  lastBackupAt: z.number().int().nullable(),
  backupReminderDays: backupReminderDaysSchema,
  backupReminderSince: z.number().int().nullable(),
  backupReminderSnoozedUntil: z.number().int().nullable(),
  viewMode: viewModeSchema,
  theme: themeSchema,
  language: languageSchema,
  openMode: openModeSchema,
  popupSize: popupSizeSchema,
  clipboardClearSec: clipboardClearSchema,
  // Set once the user picks a value; until then the stored clipboardClearSec is only a default.
  clipboardClearChosen: z.boolean(),
  recoveryCodeConfirmed: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const SETTINGS_KEY = "settings";

/** spec §5.4: default is "lock when the browser closes"; spec §7: default is this device only. */
export const DEFAULT_SETTINGS: Settings = {
  lockPolicy: { kind: "browser-close" },
  storageArea: "local",
  clockOffsetSec: 0,
  clockCheckEnabled: false,
  lastBackupAt: null,
  backupReminderDays: 30,
  backupReminderSince: null,
  backupReminderSnoozedUntil: null,
  viewMode: "normal",
  theme: "system",
  language: "system",
  openMode: "popup",
  popupSize: "medium",
  clipboardClearSec: 60,
  clipboardClearChosen: false,
  // 0.0.1 users already confirmed their code during setup.
  recoveryCodeConfirmed: true,
};

export async function loadSettings(local: StoragePort): Promise<Settings> {
  const raw = (await local.get([SETTINGS_KEY]))[SETTINGS_KEY];
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return settings;
  // Validate field by field: one corrupt field must not wipe the other settings.
  const fields = Object.keys(settingsSchema.shape) as (keyof Settings)[];
  for (const field of fields) {
    const parsed = settingsSchema.shape[field].safeParse((raw as Record<string, unknown>)[field]);
    if (parsed.success) Object.assign(settings, { [field]: parsed.data });
  }
  // Before the marker existed every save wrote the old default 0, so an unmarked 0 is not a choice.
  if (!settings.clipboardClearChosen && settings.clipboardClearSec === 0) {
    settings.clipboardClearSec = DEFAULT_SETTINGS.clipboardClearSec;
  }
  return settings;
}

export async function saveSettings(
  local: StoragePort,
  patch: Partial<Settings>,
): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await loadSettings(local)), ...patch });
  await local.set({ [SETTINGS_KEY]: next });
  return next;
}
