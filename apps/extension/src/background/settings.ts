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

export const settingsSchema = z.object({
  lockPolicy: lockPolicySchema,
  storageArea: z.enum(["local", "sync"]),
  clockOffsetSec: z.number().int(),
  clockCheckEnabled: z.boolean(),
  revealRequiresPassword: z.boolean(),
  lastBackupAt: z.number().int().nullable(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const SETTINGS_KEY = "settings";

/** spec §5.4: varsayılan "tarayıcı kapanınca kilitle"; spec §7: varsayılan yalnızca bu cihaz. */
export const DEFAULT_SETTINGS: Settings = {
  lockPolicy: { kind: "browser-close" },
  storageArea: "local",
  clockOffsetSec: 0,
  clockCheckEnabled: false,
  revealRequiresPassword: true,
  lastBackupAt: null,
};

export async function loadSettings(local: StoragePort): Promise<Settings> {
  const raw = (await local.get([SETTINGS_KEY]))[SETTINGS_KEY];
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return settings;
  // Alan alan doğrula: tek bir bozuk alan diğer ayarları silmesin.
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
