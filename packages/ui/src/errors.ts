import { RpcError } from "./rpc/client";
import type { MessageKey, Translate } from "./i18n/i18n";

const KNOWN: Record<string, MessageKey> = {
  "wrong-password": "error.wrong-password",
  locked: "error.locked",
  "invalid-token": "error.invalid-token",
  "duplicate-account": "error.duplicate-account",
  "invalid-uri": "error.invalid-uri",
  "invalid-base32": "error.invalid-base32",
  "unsupported-otp-type": "error.unsupported-otp-type",
  "unsupported-algorithm": "error.unsupported-algorithm",
  "invalid-otp-params": "error.invalid-otp-params",
  "quota-exceeded": "error.quota-exceeded",
  "preview-expired": "error.preview-expired",
  "invalid-request": "error.invalid-request",
  "invalid-recovery-code": "error.invalid-recovery-code",
  "unsupported-format": "error.unsupported-format",
  "corrupt-file": "error.corrupt-file",
  "already-set-up": "error.already-set-up",
  "no-response": "error.no-response",
  "not-found": "error.not-found",
  "snapshot-password-required": "error.snapshot-password-required",
  "same-name": "error.same-name",
  "not-linked": "error.not-linked",
  "invalid-group-name": "error.invalid-group-name",
  "duplicate-group": "error.duplicate-group",
  "group-limit": "error.group-limit",
  "group-not-found": "error.group-not-found",
};

/** Maps an RPC failure to user-facing text; unknown errors never leak their internal message. */
export function errorMessage(
  t: Translate,
  error: unknown,
  overrides: Record<string, MessageKey> = {},
): string {
  if (!(error instanceof RpcError)) return t("error.unknown");
  if (error.code === "throttled")
    return t("lock.wait", { seconds: Math.ceil((error.retryAfterMs ?? 0) / 1000) });
  const key = overrides[error.code] ?? KNOWN[error.code];
  return key ? t(key) : t("error.unknown");
}
