import { isCoreError } from "@otp-vault/core";
import { ServiceError } from "../background/errors";
import type { VaultService } from "../background/vaultService";
import {
  RPC_CHANNEL,
  rpcRequestSchema,
  type RpcErrorBody,
  type RpcRequest,
  type RpcResponse,
} from "./protocol";

export interface RpcSender {
  id?: string;
  url?: string;
}

export interface RpcContext {
  extensionId: string;
  /** `chrome-extension://<id>/` or `moz-extension://<uuid>/` */
  extensionOrigin: string;
}

export function isRpcEnvelope(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { channel?: unknown }).channel === RPC_CHANNEL
  );
}

/** Only the extension's own pages; never content scripts or web pages (spec 3.2). */
export function isTrustedSender(sender: RpcSender, ctx: RpcContext): boolean {
  // The trailing slash stops "ext" from matching "extother".
  const origin = ctx.extensionOrigin.endsWith("/")
    ? ctx.extensionOrigin
    : `${ctx.extensionOrigin}/`;
  return (
    sender.id === ctx.extensionId && typeof sender.url === "string" && sender.url.startsWith(origin)
  );
}

async function dispatch(service: VaultService, req: RpcRequest): Promise<unknown> {
  switch (req.type) {
    case "getState":
      return service.getState();
    case "setup":
      return service.setup(req);
    case "unlock":
      await service.unlock(req.password);
      return null;
    case "unlockWithRecovery":
      return service.unlockWithRecovery(req.code, req.newPassword);
    case "lock":
      await service.lock();
      return null;
    case "listSnapshots":
      return service.listSnapshots();
    case "listAccounts":
      return service.listAccounts({ pageUrl: req.pageUrl });
    case "addAccountUri":
      return service.addAccount({ uri: req.uri }, { sourceUrl: req.sourceUrl });
    case "addAccountManual":
      return service.addAccount({ draft: req.draft }, { sourceUrl: req.sourceUrl });
    case "updateAccount":
      await service.updateAccount(req.id, req.patch);
      return null;
    case "deleteAccount":
      await service.deleteAccount(req.id);
      return null;
    case "reorder":
      await service.reorder(req.order);
      return null;
    case "setPinned":
      await service.setPinned(req.id, req.pinned);
      return null;
    case "nextHotp":
      return service.nextHotp(req.id);
    case "rebuildIndex":
      await service.rebuildIndex();
      return null;
    case "reauth":
      return service.reauth(req.password);
    case "revealSecret":
      // Pass the token through as-is: coercing a missing one to "" would hide the "no token" case.
      return service.revealSecret(req.token, req.id);
    case "setRevealRequiresPassword":
      await service.setRevealRequiresPassword(req.token, req.value);
      return null;
    case "exportVault":
      return service.exportVault(req.token, req.format, req.exportPassword);
    case "changePassword":
      await service.changePassword(req.token, req.newPassword);
      return null;
    case "createRecoveryCode":
      return service.createRecoveryCode(req.token);
    case "setLockPolicy":
      await service.setLockPolicy(req.token, req.policy);
      return null;
    case "setStorageArea":
      await service.setStorageArea(req.token, req.area);
      return null;
    case "deleteVault":
      await service.deleteVault(req.token);
      return null;
    case "importPreview":
      return service.importPreview(req.text, req.password);
    case "importCommit":
      return service.importCommit(req.previewId, req.indexes);
    case "storageUsage":
      return service.storageUsage();
    case "applyClockSample":
      return service.applyClockSample(req);
    case "setClockCheckEnabled":
      await service.setClockCheckEnabled(req.enabled);
      return null;
    default: {
      const unreachable: never = req;
      throw new Error(`Unhandled request ${(unreachable as { type: string }).type}`);
    }
  }
}

function toErrorBody(e: unknown): RpcErrorBody {
  if (e instanceof ServiceError) {
    return e.retryAfterMs === undefined
      ? { code: e.code, message: e.message }
      : { code: e.code, message: e.message, retryAfterMs: e.retryAfterMs };
  }
  // Core messages can echo import or URI input, so only the code leaves the background.
  if (isCoreError(e)) return { code: e.code, message: e.code };
  // A full browser quota (e.g. storage.sync QUOTA_BYTES) needs a clear, actionable error (spec 7).
  // Write rate limits also mention quota but are transient, not "storage is full".
  if (
    e instanceof Error &&
    /QUOTA_BYTES|quota exceeded/i.test(e.message) &&
    !/MAX_WRITE_OPERATIONS/i.test(e.message)
  ) {
    return { code: "quota-exceeded", message: "Browser storage is full" };
  }
  // Unexpected errors may carry secrets, so their detail never leaves the background.
  return { code: "internal", message: "Unexpected error" };
}

export async function handleRpcMessage(
  service: VaultService,
  message: unknown,
  sender: RpcSender,
  ctx: RpcContext,
): Promise<RpcResponse | undefined> {
  if (!isRpcEnvelope(message)) return undefined;
  if (!isTrustedSender(sender, ctx)) {
    return { ok: false, error: { code: "forbidden", message: "Untrusted sender" } };
  }
  const parsed = rpcRequestSchema.safeParse((message as { request?: unknown }).request);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid-request", message: "Malformed request" } };
  }
  try {
    return { ok: true, data: await dispatch(service, parsed.data) };
  } catch (e) {
    return { ok: false, error: toErrorBody(e) };
  }
}
