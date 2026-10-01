import { isCoreError } from "../../src/errors";

/** Fonksiyonun fırlattığı CoreError kodunu döndürür; hiç hata yoksa undefined, CoreError dışı hata için "non-core-error". */
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
