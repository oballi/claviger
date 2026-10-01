import { beforeEach, describe, expect, it } from "vitest";
import { normalizeAccountInput, type AccountInput } from "../src/account/account";
import { base32Encode } from "../src/encoding/base32";
import { webRandom } from "../src/ports";
import { accountKey, INDEX_KEY, TOMBSTONE_TTL_MS, tombKey } from "../src/vault/format";
import { encryptRecord } from "../src/vault/records";
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
  vault = (await Vault.create(deps, { password: "pw", createRecoveryCode: false })).vault;
});

describe("adding and listing", () => {
  it("adds accounts in order and lists them back decrypted", async () => {
    const a = await vault.addAccount(input("GitHub"));
    deps.clock.advance(1000);
    const b = await vault.addAccount(input("Google"));
    const listing = await vault.listAccounts();
    expect(listing.accounts.map((x) => x.issuer)).toEqual(["GitHub", "Google"]);
    expect(listing.accounts[0]).toEqual(a);
    expect(b.createdAt).toBe(a.createdAt + 1000);
    expect(listing.unreadable).toEqual([]);
  });

  it("stores records encrypted", async () => {
    const a = await vault.addAccount(input("GitHub"));
    expect(JSON.stringify(deps.storage.data.get(accountKey(a.id)))).not.toContain(a.secret);
    expect(JSON.stringify(deps.storage.data.get(accountKey(a.id)))).not.toContain("GitHub");
  });

  it("detects duplicates against the vault and within the batch", async () => {
    const one = input("GitHub");
    await vault.addAccount(one);
    const two = input("Google");
    const result = await vault.addAccounts([one, two, { ...two, issuer: "Google again" }]);
    expect(result.added.map((a) => a.issuer)).toEqual(["Google"]);
    expect(result.duplicates).toHaveLength(2);
    expect(await asyncCodeOf(vault.addAccount(one))).toBe("duplicate-account");
  });

  it("writes a batch with a single storage call and leaves the vault unchanged when it fails", async () => {
    await vault.addAccount(input("Existing"));
    const before = await vault.listAccounts();
    deps.storage.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    await expect(vault.addAccounts([input("A"), input("B")])).rejects.toThrow("QUOTA_BYTES");
    expect(await vault.listAccounts()).toEqual(before);
  });
});

describe("sync-shaped data", () => {
  it("keeps indexed accounts first and appends unknown ones by createdAt (added on another device)", async () => {
    const x = await vault.addAccount(input("X"));
    deps.clock.advance(5);
    const y = await vault.addAccount(input("Y"));
    // Bu cihazın index'i yalnızca y'yi biliyor:
    deps.storage.data.set(
      INDEX_KEY,
      await encryptRecord(
        vault.exportKey(),
        INDEX_KEY,
        { order: [y.id], pinned: [], updatedAt: 1 },
        1,
        webRandom,
      ),
    );
    expect((await vault.listAccounts()).accounts.map((a) => a.id)).toEqual([y.id, x.id]);
  });

  it("hides deleted accounts via tombstones and does not resurrect stale copies", async () => {
    const a = await vault.addAccount(input("Gone"));
    const staleRecord = deps.storage.data.get(accountKey(a.id));
    deps.clock.advance(1000);
    await vault.deleteAccount(a.id);
    expect(deps.storage.data.has(accountKey(a.id))).toBe(false);
    expect(deps.storage.data.get(tombKey(a.id))).toEqual({ deletedAt: deps.clock.ms });
    // Another device syncs back its older copy of the record:
    deps.storage.data.set(accountKey(a.id), staleRecord);
    expect((await vault.listAccounts()).accounts).toEqual([]);
  });

  it("tombstones are newer than the deleted record even without clock movement", async () => {
    const a = await vault.addAccount(input("Busy"));
    await vault.updateAccount(a.id, { label: "1" });
    await vault.updateAccount(a.id, { label: "2" });
    await vault.updateAccount(a.id, { label: "3" });
    const lastRecord = deps.storage.data.get(accountKey(a.id));
    await vault.deleteAccount(a.id);
    deps.storage.data.set(accountKey(a.id), lastRecord); // remove() kaçtı veya eski kopya sync'ten döndü
    expect((await vault.listAccounts()).accounts).toEqual([]);
  });

  it("shows a record that was re-saved after the tombstone", async () => {
    const a = await vault.addAccount(input("Back"));
    await vault.deleteAccount(a.id);
    const { deletedAt } = deps.storage.data.get(tombKey(a.id)) as { deletedAt: number };
    const resaved = { ...a, issuer: "Back again", updatedAt: deletedAt + 5 };
    deps.storage.data.set(
      accountKey(a.id),
      await encryptRecord(
        vault.exportKey(),
        accountKey(a.id),
        resaved,
        resaved.updatedAt,
        webRandom,
      ),
    );
    expect((await vault.listAccounts()).accounts).toEqual([resaved]);
  });

  it("marks undecryptable or swapped records as unreadable without hiding the rest", async () => {
    const a = await vault.addAccount(input("A"));
    const b = await vault.addAccount(input("B"));
    const c = await vault.addAccount(input("C"));
    deps.storage.data.set(accountKey(b.id), {
      v: 1,
      iv: "AAAAAAAAAAAAAAAA",
      ct: "AAAA",
      updatedAt: 0,
    });
    deps.storage.data.set(accountKey(c.id), deps.storage.data.get(accountKey(a.id))); // swap attack
    deps.storage.data.set(accountKey("junk"), "not a record");
    const listing = await vault.listAccounts();
    expect(listing.accounts.map((x) => x.id)).toEqual([a.id]);
    expect(listing.unreadable).toEqual([b.id, c.id, "junk"].sort());
  });
});

describe("editing", () => {
  it("updates editable fields, keeps the secret and bumps updatedAt", async () => {
    const a = await vault.addAccount(input("Old", { domains: [] }));
    const updated = await vault.updateAccount(a.id, {
      issuer: "New",
      label: "x",
      domains: ["https://login.new.com"],
    });
    expect(updated).toMatchObject({
      id: a.id,
      issuer: "New",
      label: "x",
      domains: ["new.com"],
      secret: a.secret,
      createdAt: a.createdAt,
    });
    expect(updated.updatedAt).toBeGreaterThan(a.updatedAt);
    expect(await vault.getAccount(a.id)).toEqual(updated);
  });

  it("validates updates", async () => {
    const a = await vault.addAccount(input("A"));
    expect(await asyncCodeOf(vault.updateAccount(a.id, { digits: 12 }))).toBe("invalid-otp-params");
    expect(await asyncCodeOf(vault.updateAccount("missing", { issuer: "x" }))).toBe(
      "account-not-found",
    );
  });

  it("increments HOTP counters persistently", async () => {
    const h = await vault.addAccount(input("H", { type: "hotp", counter: 4 }));
    expect((await vault.incrementHotp(h.id)).counter).toBe(5);
    expect((await vault.getAccount(h.id)).counter).toBe(5);
    const t = await vault.addAccount(input("T"));
    expect(await asyncCodeOf(vault.incrementHotp(t.id))).toBe("invalid-otp-params");
  });

  it("deleting a missing account fails", async () => {
    expect(await asyncCodeOf(vault.deleteAccount("missing"))).toBe("account-not-found");
  });
});

describe("ordering and pinning", () => {
  it("reorders, ignoring unknown ids and keeping omitted ones at the end", async () => {
    const [a, b, c] = [
      await vault.addAccount(input("A")),
      await vault.addAccount(input("B")),
      await vault.addAccount(input("C")),
    ];
    await vault.reorder([c.id, "ghost", a.id]);
    expect((await vault.listAccounts()).accounts.map((x) => x.issuer)).toEqual(["C", "A", "B"]);
    void b;
  });

  it("pins and unpins", async () => {
    const a = await vault.addAccount(input("A"));
    await vault.setPinned(a.id, true);
    await vault.setPinned(a.id, true);
    expect((await vault.listAccounts()).pinned).toEqual([a.id]);
    await vault.setPinned(a.id, false);
    expect((await vault.listAccounts()).pinned).toEqual([]);
  });

  it("drops deleted accounts from order and pins", async () => {
    const a = await vault.addAccount(input("A"));
    await vault.setPinned(a.id, true);
    await vault.deleteAccount(a.id);
    expect(await vault.listAccounts()).toEqual({ accounts: [], pinned: [], unreadable: [] });
  });
});

describe("restoring from a cached key", () => {
  it("rejects a foreign key even when the index has not synced yet", async () => {
    await vault.addAccount(input("A"));
    deps.storage.data.delete(INDEX_KEY);
    expect(await asyncCodeOf(Vault.fromKey(deps, webRandom.bytes(32)))).toBe("wrong-password");
    await Vault.fromKey(deps, vault.exportKey());
  });

  it("accepts a valid key when the first account record is corrupt but the index exists", async () => {
    const a = await vault.addAccount(input("A"));
    const b = await vault.addAccount(input("B"));
    const first = [a.id, b.id].sort()[0] as string;
    deps.storage.data.set(accountKey(first), {
      v: 1,
      iv: "AAAAAAAAAAAAAAAA",
      ct: "AAAA",
      updatedAt: 0,
    });
    await Vault.fromKey(deps, vault.exportKey());
    expect(await asyncCodeOf(Vault.fromKey(deps, webRandom.bytes(32)))).toBe("wrong-password");
  });

  it("rejects a key that is not 32 bytes", async () => {
    expect(await asyncCodeOf(Vault.fromKey(deps, new Uint8Array(16)))).toBe("wrong-password");
  });
});

describe("corrupt index", () => {
  it("still lists accounts but refuses writes that would wipe order and pins", async () => {
    const a = await vault.addAccount(input("A"));
    deps.storage.data.set(INDEX_KEY, { v: 1, iv: "AAAAAAAAAAAAAAAA", ct: "AAAA", updatedAt: 0 });
    expect((await vault.listAccounts()).accounts.map((x) => x.id)).toEqual([a.id]);
    expect(await asyncCodeOf(vault.setPinned(a.id, true))).toBe("vault-corrupt");
    expect(await asyncCodeOf(vault.addAccount(input("B")))).toBe("vault-corrupt");
  });
});

describe("tombstone purge", () => {
  it("removes tombstones older than the TTL", async () => {
    const a = await vault.addAccount(input("A"));
    await vault.deleteAccount(a.id);
    expect(await vault.purgeTombstones()).toBe(0);
    deps.clock.advance(TOMBSTONE_TTL_MS + 10);
    expect(await vault.purgeTombstones()).toBe(1);
    expect(deps.storage.data.has(tombKey(a.id))).toBe(false);
  });
});
