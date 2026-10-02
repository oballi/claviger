import { base32Decode } from "../encoding/base32";
import { CoreError } from "../errors";

/** Same ceiling as the importCommit `indexes` schema; more entries could never be committed. */
export const MAX_IMPORT_ENTRIES = 10_000;

/** Detection only samples the head of a list so a hostile array cannot make sniffing quadratic. */
export const DETECT_SAMPLE = 50;

export function assertEntryCount(count: number): void {
  if (count > MAX_IMPORT_ENTRIES)
    throw new CoreError("unsupported-format", `More than ${MAX_IMPORT_ENTRIES} entries`);
}

// Real Steam shared secrets are 20 bytes; shorter ones are truncated or garbage.
const MIN_STEAM_SECRET_BYTES = 10;

export function assertSteamSecret(secret: string): void {
  if (base32Decode(secret).length < MIN_STEAM_SECRET_BYTES)
    throw new CoreError("corrupt-file", "Steam secret is too short");
}
