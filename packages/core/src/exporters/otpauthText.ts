import type { AccountInput } from "../account/account";
import { toOtpauthUri } from "../uri/otpauth";

/** Düz metin export: secret'lar AÇIKTA. UI bunu ancak açık uyarı ve ikinci onaydan sonra sunar (spec §6.6). */
export function exportOtpauthText(accounts: AccountInput[]): string {
  return accounts.map(toOtpauthUri).join("\n") + "\n";
}
