import { normalizeAccountInput, type AccountDraft, type AccountInput } from "../account/account";
import { isCoreError } from "../errors";

export type ImportIssueReason =
  | "invalid-secret"
  | "unsupported-type"
  | "unsupported-algorithm"
  | "invalid-params"
  | "malformed-entry";

export interface ImportIssue {
  /** Kaynaktaki 0 tabanlı kayıt sırası */
  position: number;
  /** Kullanıcıya gösterilecek ad (issuer/hesap). Asla secret içermez. */
  name: string;
  reason: ImportIssueReason;
  detail?: string;
}

export interface ImportResult {
  accounts: AccountInput[];
  issues: ImportIssue[];
}

export const emptyResult = (): ImportResult => ({ accounts: [], issues: [] });

export function reasonFromError(e: unknown): ImportIssueReason {
  if (isCoreError(e, "invalid-base32") || isCoreError(e, "invalid-hex")) return "invalid-secret";
  if (isCoreError(e, "unsupported-otp-type")) return "unsupported-type";
  if (isCoreError(e, "unsupported-algorithm")) return "unsupported-algorithm";
  if (isCoreError(e, "invalid-otp-params")) return "invalid-params";
  return "malformed-entry";
}

/** Draft'ı normalize edip sonuca ekler; hata olursa nedeniyle birlikte sorun olarak kaydeder. */
export function collect(
  result: ImportResult,
  position: number,
  name: string,
  draft: AccountDraft | (() => AccountDraft),
): void {
  try {
    result.accounts.push(normalizeAccountInput(typeof draft === "function" ? draft() : draft));
  } catch (e) {
    result.issues.push({
      position,
      name,
      reason: reasonFromError(e),
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
