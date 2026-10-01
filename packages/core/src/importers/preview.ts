import { accountFingerprint, type AccountInput } from "../account/account";

export interface PreviewItem {
  account: AccountInput;
  status: "new" | "duplicate";
}

export function buildImportPreview(
  candidates: AccountInput[],
  existing: { type: string; secret: string }[],
): PreviewItem[] {
  const seen = new Set(existing.map(accountFingerprint));
  return candidates.map((account) => {
    const fingerprint = accountFingerprint(account);
    const status = seen.has(fingerprint) ? "duplicate" : "new";
    seen.add(fingerprint);
    return { account, status };
  });
}
