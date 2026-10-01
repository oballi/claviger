import { CoreError } from "../errors";
import type { StoragePort } from "../ports";
import { isVaultKey } from "./format";

/**
 * Tüm `vault:*` anahtarlarını `from`'dan `to`'ya taşır: kopyala → doğrula → kaynağı sil (spec §7).
 * Doğrulama başarısız olursa hedef temizlenir, kaynak dokunulmadan kalır.
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
  await to.set(items);
  const written = await to.get(keys);
  const verified = keys.every((key) => JSON.stringify(written[key]) === JSON.stringify(items[key]));
  if (!verified) {
    await to.remove(keys);
    throw new CoreError("vault-corrupt", "Copy verification failed");
  }
  await from.remove(keys);
  return keys.length;
}
