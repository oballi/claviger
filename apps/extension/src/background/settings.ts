import "../zodConfig";
import type { StoragePort } from "@otp-vault/core";
import { z } from "zod";

export const lockPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("browser-close") }),
  z.object({ kind: z.literal("browser-close-or-screen-lock") }),
  z.object({
    kind: z.literal("timeout"),
    minutes: z.union([z.literal(15), z.literal(60), z.literal(240)]),
  }),
  z.object({ kind: z.literal("never") }),
]);

export type LockPolicy = z.infer<typeof lockPolicySchema>;

export const viewModeSchema = z.enum(["normal", "compact", "hidden"]);
export type ViewMode = z.infer<typeof viewModeSchema>;
export const clipboardClearSchema = z.union([z.literal(0), z.literal(30), z.literal(60)]);
export type ClipboardClearSec = z.infer<typeof clipboardClearSchema>;

export const settingsSchema = z.object({
  lockPolicy: lockPolicySchema,
  storageArea: z.enum(["local", "sync"]),
  clockOffsetSec: z.number().int(),
  clockCheckEnabled: z.boolean(),
  revealRequiresPassword: z.boolean(),
  lastBackupAt: z.number().int().nullable(),
  viewMode: viewModeSchema,
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
