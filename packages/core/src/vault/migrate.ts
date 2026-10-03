import { CoreError } from "../errors";
import type { StoragePort } from "../ports";
import { canonicalJson } from "./canonical";
import { isVaultKey } from "./format";

/**
 * Moves all `vault:*` keys from `from` to `to`: copy -> verify -> delete source.
 * If verification fails the target is cleaned up and the source is left untouched.
 */
export async function moveVaultData(from: StoragePort, to: StoragePort): Promise<number> {
  const items = Object.fromEntries(
    Object.entries(await from.get()).filter(([key]) => isVaultKey(key)),
  );
  const keys = Object.keys(items);
  if (keys.length === 0) return 0;
  if (Object.keys(await to.get()).some(isVaultKey)) {
    throw new CoreError("vault-exists", "The destination already contains a vault");
  }
  try {
    await to.set(items);
  } catch (error) {
    await to.remove(keys).catch(() => {});
    throw error;
  }
  const written = await to.get(keys);
  const verified = keys.every((key) => canonicalJson(written[key]) === canonicalJson(items[key]));
  if (!verified) {
    await to.remove(keys);
    throw new CoreError("vault-corrupt", "Copy verification failed");
  }
  await from.remove(keys);
  return keys.length;
}
