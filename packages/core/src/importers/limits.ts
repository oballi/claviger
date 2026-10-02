import { CoreError } from "../errors";

/** Same ceiling as the importCommit `indexes` schema; more entries could never be committed. */
export const MAX_IMPORT_ENTRIES = 10_000;

export function assertEntryCount(count: number): void {
  if (count > MAX_IMPORT_ENTRIES)
    throw new CoreError("unsupported-format", `More than ${MAX_IMPORT_ENTRIES} entries`);
}
