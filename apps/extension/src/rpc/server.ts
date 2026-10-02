import { isCoreError, isQuotaError } from "@claviger/core";
import { ServiceError } from "../background/errors";
import type { VaultService } from "../background/vaultService";
import {
  RPC_CHANNEL,
  rpcRequestSchema,
  type RpcErrorBody,
  type RpcRequest,
  type RpcResponse,
} from "@claviger/ui/protocol";

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

function isScanPage(sender: RpcSender): boolean {
  try {
    return new URL(sender.url ?? "").pathname === "/scan.html";
  } catch {
    return false;
  }
}

async function dispatch(
  service: VaultService,
  req: RpcRequest,
  sender: RpcSender,
): Promise<unknown> {
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
    case "restoreSnapshot":
      return service.restoreSnapshot(req.token, req.id, req.password);
    case "quarantineVault":
      return service.quarantineVault();
    case "listAccounts":
      return service.listAccounts({ pageUrl: req.pageUrl, passive: req.passive });
    case "addAccountUri":
      return service.addAccount(
        { uri: req.uri },
        { sourceUrl: req.sourceUrl, allowSameName: req.allowSameName },
      );
    case "addAccountManual":
      return service.addAccount(
        { draft: req.draft },
        { sourceUrl: req.sourceUrl, allowSameName: req.allowSameName },
      );
    case "updateAccount":
      await service.updateAccount(req.id, req.patch);
      return null;
    case "createGroup":
      return service.createGroup(req.name);
    case "renameGroup":
      await service.renameGroup(req.id, req.name);
      return null;
    case "deleteGroup":
      await service.deleteGroup(req.id);
      return null;
    case "reorderGroups":
      await service.reorderGroups(req.ids);
      return null;
    case "setAccountGroup":
      await service.setAccountGroup(req.id, req.groupId);
      return null;
    case "deleteAccount":
      await service.deleteAccount(req.id);
      return null;
    case "listTrash":
      return service.listTrash();
    case "restoreTrash":
      return service.restoreTrash(req.id);
    case "listDuplicates":
      return service.listDuplicates();
    case "mergeAccounts":
      return service.mergeAccounts(req.keepId, req.removeIds);
    case "undoMerge":
      return service.undoMerge(req.undoId);
    case "purgeTrash":
      await service.purgeTrash(req.id);
      return null;
    case "emptyTrash":
      return service.emptyTrash();
    case "moveAccount":
      await service.moveAccount(req.id, req.groupId, req.beforeId);
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
    case "setViewMode":
      await service.setViewMode(req.mode);
      return null;
    case "setTheme":
      await service.setTheme(req.theme);
      return null;
    case "setLanguage":
      await service.setLanguage(req.language);
      return null;
    case "setClipboardClear":
      await service.setClipboardClear(req.seconds);
      return null;
    case "setBackupReminder":
      await service.setBackupReminder(req.days);
      return null;
    case "dismissBackupReminder":
      await service.dismissBackupReminder();
      return null;
    case "confirmRecoveryCode":
      await service.confirmRecoveryCode();
      return null;
    case "clipboardCopied":
      await service.clipboardCopied();
      return null;
    case "exportVault":
      return service.exportVault(req.token, req.format, req.exportPassword);
    case "exportMigration":
      return service.exportMigration(req.token, req.ids);
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
    case "storeCapture":
      return service.storeCapture({ dataUrl: req.dataUrl, tabUrl: req.tabUrl });
    case "takeCapture":
      // Only the scan page may take a capture; the popup never needs it.
      if (!isScanPage(sender)) throw new ServiceError("invalid-request", "Not the scan page");
      return service.takeCapture(req.id);
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
  if (isQuotaError(e)) return { code: "quota-exceeded", message: "Browser storage is full" };
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
    return { ok: true, data: await dispatch(service, parsed.data, sender) };
  } catch (e) {
    return { ok: false, error: toErrorBody(e) };
  }
}
