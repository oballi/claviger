import { z } from "zod";
import type { AccountDraft } from "../account/account";
import { CoreError } from "../errors";
import { parseOtpauthUri } from "../uri/otpauth";
import { assertEntryCount } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

const fileSchema = z.object({
  encrypted: z.boolean().optional(),
  passwordProtected: z.boolean().optional(),
  items: z.array(z.unknown()),
});
const itemSchema = z.object({
  name: z.string().nullish(),
  login: z.object({ username: z.string().nullish(), totp: z.string().nullish() }).nullish(),
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function isBitwardenFile(json: unknown): boolean {
  if (!isObject(json)) return false;
  // Encrypted exports carry `data` (password-protected) or `items` of EncStrings (account-restricted).
  if (json.encrypted === true) return typeof json.data === "string" || Array.isArray(json.items);
  const file = fileSchema.safeParse(json);
  if (!file.success) return false;
  // `items` alone is too common a key; require the Bitwarden login shape on one element.
  return file.data.items.some(
    (i) => isObject(i) && isObject(i.login) && itemSchema.safeParse(i).success,
  );
}

const STEAM = /^steam:\/\/([A-Za-z2-7]+=*)/;

export async function parseBitwarden(json: unknown): Promise<ImportResult> {
  if (isObject(json) && json.encrypted === true)
    throw new CoreError(
      "unsupported-format",
      "Encrypted Bitwarden exports are not supported; export as unencrypted .json",
    );
  const parsed = fileSchema.safeParse(json);
  if (!parsed.success) throw new CoreError("unsupported-format", "Not a Bitwarden export");
  const file = parsed.data;
  assertEntryCount(file.items.length);
  const result = emptyResult();
  file.items.forEach((raw, position) => {
    const item = itemSchema.safeParse(raw);
    if (!item.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const totp = item.data.login?.totp?.trim();
    if (!totp) return; // a password/note item, not a 2FA account
    const name = item.data.name ?? "";
    const username = item.data.login?.username ?? "";
    collect(result, position, name, (): AccountDraft => {
      const steam = STEAM.exec(totp);
      if (steam)
        return { type: "steam", secret: steam[1]!, issuer: name || "Steam", label: username };
      if (/^otpauth:\/\//i.test(totp)) {
        const p = parseOtpauthUri(totp);
        return { ...p, issuer: p.issuer || name, label: p.label || username };
      }
      return { secret: totp.replace(/\s+/g, ""), issuer: name, label: username };
    });
  });
  return result;
}
