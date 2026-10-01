import { parseOtpauthUri } from "../uri/otpauth";
import { parseGoogleMigrationUri } from "./googleMigration";
import { emptyResult, reasonFromError, type ImportResult } from "./types";

function labelOf(line: string): string {
  const match = /^otpauth:\/\/[a-z0-9]+\/([^?]*)/i.exec(line);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return match[1] ?? "";
  }
}

export function parseOtpauthText(text: string): ImportResult {
  const result = emptyResult();
  let position = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^otpauth-migration:/i.test(line)) {
      try {
        const migration = parseGoogleMigrationUri(line);
        result.accounts.push(...migration.accounts);
        result.issues.push(
          ...migration.issues.map((i) => ({ ...i, position: position + i.position })),
        );
        position += migration.accounts.length + migration.issues.length;
      } catch (e) {
        result.issues.push({
          position: position++,
          name: "",
          reason: "malformed-entry",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }

    const current = position++;
    try {
      result.accounts.push(parseOtpauthUri(line));
    } catch (e) {
      result.issues.push({
        position: current,
        name: labelOf(line),
        reason: reasonFromError(e),
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return result;
}
