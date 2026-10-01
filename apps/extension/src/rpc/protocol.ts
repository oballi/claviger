import { z } from "zod";
import { lockPolicySchema } from "../background/settings";
import type {
  AccountListView,
  ImportPreviewView,
  ServiceState,
  StorageUsageView,
} from "../background/vaultService";

export const RPC_CHANNEL = "otp-vault/rpc";

const id = z.string().min(1);
const token = z.string().min(1);
const area = z.enum(["local", "sync"]);

const accountDraft = z.object({
  secret: z.string(),
  type: z.string().optional(),
  algorithm: z.string().optional(),
  issuer: z.string().optional(),
  label: z.string().optional(),
  digits: z.number().optional(),
  period: z.number().optional(),
  counter: z.number().optional(),
  domains: z.array(z.string()).optional(),
});

const accountPatch = z.object({
  issuer: z.string().optional(),
  label: z.string().optional(),
  domains: z.array(z.string()).optional(),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).optional(),
  digits: z.number().int().optional(),
  period: z.number().int().optional(),
});

export const rpcRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("getState") }),
  z.object({
    type: z.literal("setup"),
    password: z.string(),
    createRecoveryCode: z.boolean(),
    lockPolicy: lockPolicySchema,
    storageArea: area,
  }),
  z.object({ type: z.literal("unlock"), password: z.string() }),
  z.object({ type: z.literal("unlockWithRecovery"), code: z.string(), newPassword: z.string() }),
  z.object({ type: z.literal("lock") }),
  z.object({ type: z.literal("listAccounts"), pageUrl: z.string().optional() }),
  z.object({ type: z.literal("addAccountUri"), uri: z.string(), sourceUrl: z.string().optional() }),
  z.object({
    type: z.literal("addAccountManual"),
    draft: accountDraft,
    sourceUrl: z.string().optional(),
  }),
  z.object({ type: z.literal("updateAccount"), id, patch: accountPatch }),
  z.object({ type: z.literal("deleteAccount"), id }),
  z.object({ type: z.literal("reorder"), order: z.array(z.string()) }),
  z.object({ type: z.literal("setPinned"), id, pinned: z.boolean() }),
  z.object({ type: z.literal("nextHotp"), id }),
  z.object({ type: z.literal("rebuildIndex") }),
  z.object({ type: z.literal("reauth"), password: z.string() }),
  // Optional: the service decides whether a token is required (revealRequiresPassword setting).
  z.object({ type: z.literal("revealSecret"), token: token.optional(), id }),
  z.object({ type: z.literal("setRevealRequiresPassword"), token, value: z.boolean() }),
  z.object({
    type: z.literal("exportVault"),
    token,
    format: z.enum(["otpvault", "otpauth"]),
    exportPassword: z.string().optional(),
  }),
  z.object({ type: z.literal("changePassword"), token, newPassword: z.string() }),
  z.object({ type: z.literal("createRecoveryCode"), token }),
  z.object({ type: z.literal("setLockPolicy"), token, policy: lockPolicySchema }),
  z.object({ type: z.literal("setStorageArea"), token, area }),
  z.object({ type: z.literal("deleteVault"), token }),
  z.object({
    type: z.literal("importPreview"),
    text: z.string().max(5_000_000),
    password: z.string().optional(),
  }),
  z.object({
    type: z.literal("importCommit"),
    previewId: z.string(),
    indexes: z.array(z.number().int()),
  }),
  z.object({ type: z.literal("storageUsage") }),
  z.object({
    type: z.literal("applyClockSample"),
    serverDate: z.string(),
    startMs: z.number(),
    endMs: z.number(),
  }),
  z.object({ type: z.literal("setClockCheckEnabled"), enabled: z.boolean() }),
]);

export type RpcRequest = z.infer<typeof rpcRequestSchema>;
export type RpcType = RpcRequest["type"];
export type RpcPayload<T extends RpcType> = Omit<Extract<RpcRequest, { type: T }>, "type">;

export interface RpcResults {
  getState: ServiceState;
  setup: { recoveryCode: string | null };
  unlock: null;
  unlockWithRecovery: { recoveryCode: string };
  lock: null;
  listAccounts: AccountListView;
  addAccountUri: { id: string };
  addAccountManual: { id: string };
  updateAccount: null;
  deleteAccount: null;
  reorder: null;
  setPinned: null;
  nextHotp: { code: string };
  rebuildIndex: null;
  reauth: { token: string };
  revealSecret: { uri: string };
  setRevealRequiresPassword: null;
  exportVault: { filename: string; content: string; count: number; skipped: number };
  changePassword: null;
  createRecoveryCode: { recoveryCode: string };
  setLockPolicy: null;
  setStorageArea: null;
  deleteVault: null;
  importPreview: ImportPreviewView;
  importCommit: { added: number; duplicates: number };
  storageUsage: StorageUsageView;
  applyClockSample: { offsetSec: number; applied: number };
  setClockCheckEnabled: null;
}

export interface RpcErrorBody {
  code: string;
  message: string;
  retryAfterMs?: number;
}

export type RpcResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: RpcErrorBody };
