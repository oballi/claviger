import { beforeEach, describe, expect, it } from "vitest";
import { accountSchema, normalizeAccountInput, type AccountInput } from "../src/account/account";
import { base32Encode } from "../src/encoding/base32";
import { webRandom } from "../src/ports";
import { accountKey, encryptedRecordSchema } from "../src/vault/format";
import { decryptRecord } from "../src/vault/records";
import { Vault } from "../src/vault/vault";
import { asyncCodeOf } from "./helpers/errors";
import { makeDeps } from "./helpers/vault";

const input = (issuer: string, extra: Partial<AccountInput> = {}): AccountInput =>
  normalizeAccountInput({
    secret: base32Encode(webRandom.bytes(20)),
    issuer,
    label: `${issuer.toLowerCase()}@me`,
    ...extra,
  });

let deps: ReturnType<typeof makeDeps>;
let vault: Vault;

beforeEach(async () => {
  deps = makeDeps();
  vault = (await Vault.create(deps, { password: "pw", createRecoveryCode: true })).vault;
});

describe("serialized mutations", () => {
  it("never hands out the same HOTP counter twice", async () => {
    const h = await vault.addAccount(input("H", { type: "hotp", counter: 4 }));
    const results = await Promise.all([vault.incrementHotp(h.id), vault.incrementHotp(h.id)]);
    expect(results.map((a) => a.counter).sort()).toEqual([5, 6]);
    const raw = encryptedRecordSchema.parse(deps.storage.data.get(accountKey(h.id)));
    const stored = await decryptRecord(vault.exportKey(), accountKey(h.id), raw, accountSchema);
    expect(stored?.counter).toBe(6);
  });

  it("does not store the same account twice when added concurrently", async () => {
    const x = input("Dup");
    const results = await Promise.allSettled([vault.addAccount(x), vault.addAccount(x)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(await asyncCodeOf(Promise.reject(rejected?.reason))).toBe("duplicate-account");
    expect((await vault.listAccounts()).accounts).toHaveLength(1);
  });

  it("shares the lock between Vault instances on the same storage", async () => {
    const a = await vault.addAccount(input("A"));
    const b = await vault.addAccount(input("B"));
    const one = await Vault.fromKey(deps, vault.exportKey());
    const two = await Vault.fromKey(deps, vault.exportKey());
    await Promise.all([one.setPinned(a.id, true), two.reorder([b.id, a.id])]);
    const listing = await vault.listAccounts();
    expect(listing.pinned).toEqual([a.id]);
    expect(listing.accounts.map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it("does not let a failed mutation block the next one", async () => {
    const a = await vault.addAccount(input("A"));
    deps.storage.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    const [first, second] = await Promise.allSettled([
      vault.setPinned(a.id, true),
      vault.updateAccount(a.id, { label: "after" }),
    ]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
    expect((await vault.getAccount(a.id)).label).toBe("after");
  });

  it("serializes keyslot changes with recovery unlock", async () => {
    const code = await vault.createRecoveryCode();
    const [, recovered] = await Promise.all([
      vault.changePassword("other"),
      Vault.unlockWithRecovery(deps, code, "fresh"),
    ]);
    expect(await recovered.vault.verifyPassword("fresh")).toBe(true);
  });
});
