import type { Account } from "@claviger/core";
import type { VaultService } from "../../src/background/vaultService";

export type Internals = {
  getAccount(id: string): Promise<Account>;
  readIndex(): Promise<{ order: string[]; updatedAt: number }>;
  writeAccount(a: Account): Promise<void>;
  writeIndex(index: object): Promise<void>;
  deleteAccount(id: string): Promise<void>;
};
export const internals = (service: VaultService) =>
  (service as unknown as { vault: Internals }).vault;

/** Duplicates only arise from sync races, so the tests write the second record behind the API's back. */
export async function plant(service: VaultService, sourceId: string, over: Partial<Account> = {}) {
  const v = internals(service);
  const src = await v.getAccount(sourceId);
  const index = await v.readIndex();
  const copy: Account = {
    ...src,
    id: crypto.randomUUID(),
    createdAt: src.createdAt + index.order.length,
    updatedAt: src.updatedAt + 1,
    ...over,
  };
  await v.writeAccount(copy);
  await v.writeIndex({
    ...index,
    order: [...index.order, copy.id],
    updatedAt: index.updatedAt + 1,
  });
  return copy;
}
