import type { AccountInput } from "../account/account";
import { toOtpauthUri } from "../uri/otpauth";

/** Plain-text export: secrets in the CLEAR. The UI offers it only after an explicit warning and a second confirmation (spec §6.6). */
export function exportOtpauthText(accounts: AccountInput[]): string {
  return accounts.map(toOtpauthUri).join("\n") + "\n";
}
