import "../zodConfig";
import type { StoragePort } from "@otp-vault/core";
import {
  clipboardClearSchema,
  lockPolicySchema,
  themeSchema,
  viewModeSchema,
  type ClipboardClearSec,
  type LockPolicy,
  type Theme,
  type ViewMode,
} from "@otp-vault/ui/protocol";
import { z } from "zod";

export { clipboardClearSchema, lockPolicySchema, themeSchema, viewModeSchema };
export type { ClipboardClearSec, LockPolicy, Theme, ViewMode };

export const settingsSchema = z.object({
  lockPolicy: lockPolicySchema,
  storageArea: z.enum(["local", "sync"]),
  clockOffsetSec: z.number().int(),
  clockCheckEnabled: z.boolean(),
  revealRequiresPassword: z.boolean(),
  lastBackupAt: z.number().int().nullable(),
  viewMode: viewModeSchema,
  theme: themeSchema,
  clipboardClearSec: clipboardClearSchema,
  recoveryCodeConfirmed: z.boolean(),
  fillOnlyLinked: z.boolean(),
  siteMemory: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const SETTINGS_KEY = "settings";

/** spec §5.4: default is "lock when the browser closes"; spec §7: default is this device only. */
export const DEFAULT_SETTINGS: Settings = {
  lockPolicy: { kind: "browser-close" },
  storageArea: "local",
  clockOffsetSec: 0,
  clockCheckEnabled: false,
  revealRequiresPassword: true,
  lastBackupAt: null,
  viewMode: "normal",
  theme: "system",
  clipboardClearSec: 0,
  // 0.0.1 users already confirmed their code during setup.
  recoveryCodeConfirmed: true,
  fillOnlyLinked: true,
  siteMemory: true,
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
