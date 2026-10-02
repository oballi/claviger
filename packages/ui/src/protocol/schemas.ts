import "./zodConfig";
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

export const SNAPSHOT_REASONS = [
  "daily",
  "before-import",
  "before-delete",
  "before-move",
  "before-restore",
  "before-rebuild",
  "before-recovery",
] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];
