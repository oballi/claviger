import { isCoreError } from "../../src/errors";

/** Returns the CoreError code thrown by the function; undefined if nothing is thrown, "non-core-error" for a non-CoreError. */
export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCoreError(e) ? e.code : "non-core-error";
  }
  return undefined;
}

export async function asyncCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return isCoreError(e) ? e.code : "non-core-error";
  }
  return undefined;
}
