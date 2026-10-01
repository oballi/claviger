import {
  accountFingerprint,
  accountSchema,
  normalizeAccountInput,
  type Account,
  type AccountInput,
} from "../account/account";
import { openBytes } from "../crypto/aes";
import { DEFAULT_ARGON2 } from "../crypto/kdf";
import { CoreError } from "../errors";
import type { StoragePort, VaultDeps } from "../ports";
import {
  ACCOUNT_PREFIX,
  accountKey,
  encryptedRecordSchema,
  HEADER_KEY,
  headerSchema,
  INDEX_KEY,
  indexSchema,
  TOMB_PREFIX,
  tombKey,
  tombSchema,
  TOMBSTONE_TTL_MS,
  type VaultHeader,
  type VaultIndex,
} from "./format";
import {
  createPasswordKeyslot,
  createRecoveryKeyslot,
  openPasswordKeyslot,
  type Keyslot,
  type PasswordKeyslot,
} from "./keyslot";
import { decryptRecord, encryptRecord, recordAad } from "./records";
import { generateRecoveryCode } from "./recovery";

export interface CreateVaultOptions {
  password: string;
  createRecoveryCode: boolean;
}

export interface VaultListing {
  accounts: Account[];
  pinned: string[];
  unreadable: string[];
}

export type AccountPatch = Partial<
  Pick<AccountInput, "issuer" | "label" | "domains" | "algorithm" | "digits" | "period">
>;

const EMPTY_INDEX: VaultIndex = { order: [], pinned: [], updatedAt: 0 };

export class Vault {
  private constructor(
    private readonly deps: VaultDeps,
    private readonly dek: Uint8Array,
    private header: VaultHeader,
  ) {}

  get vaultId(): string {
    return this.header.vaultId;
  }

  static async exists(storage: StoragePort): Promise<boolean> {
    return HEADER_KEY in (await storage.get([HEADER_KEY]));
  }

  static async create(
    deps: VaultDeps,
    opts: CreateVaultOptions,
  ): Promise<{ vault: Vault; recoveryCode: string | null }> {
    if (await Vault.exists(deps.storage))
      throw new CoreError("vault-exists", "A vault already exists");
    const vaultId = deps.random.uuid();
    const dek = deps.random.bytes(32);
    const keyslots: Keyslot[] = [
      await createPasswordKeyslot(
        dek,
        opts.password,
        vaultId,
        deps.random,
        deps.kdf ?? DEFAULT_ARGON2,
      ),
    ];
    let recoveryCode: string | null = null;
    if (opts.createRecoveryCode) {
      const recovery = generateRecoveryCode(deps.random);
      keyslots.push(await createRecoveryKeyslot(dek, recovery.secret, vaultId, deps.random));
      recoveryCode = recovery.code;
    }
    const now = deps.clock.now();
    const header: VaultHeader = { format: 1, vaultId, keyslots, createdAt: now };
    const index: VaultIndex = { order: [], pinned: [], updatedAt: now };
    await deps.storage.set({
      [HEADER_KEY]: header,
      [INDEX_KEY]: await encryptRecord(dek, INDEX_KEY, index, now, deps.random),
    });
    return { vault: new Vault(deps, dek, header), recoveryCode };
  }

  static async unlockWithPassword(deps: VaultDeps, password: string): Promise<Vault> {
    const header = await Vault.readHeader(deps.storage);
    const dek = await openPasswordKeyslot(Vault.passwordSlot(header), password, header.vaultId);
    if (!dek) throw new CoreError("wrong-password", "Wrong password");
    return new Vault(deps, dek, header);
  }

  /** Host'un oturum deposunda sakladığı DEK ile kasayı yeniden açar. */
  static async fromKey(deps: VaultDeps, dek: Uint8Array): Promise<Vault> {
    if (dek.length !== 32)
      throw new CoreError("wrong-password", "The cached key has an invalid length");
    const header = await Vault.readHeader(deps.storage);
    const vault = new Vault(deps, dek.slice(), header);
    if ((await vault.indexOpens()) === false) {
      throw new CoreError("wrong-password", "The cached key does not open this vault");
    }
    return vault;
  }

  exportKey(): Uint8Array {
    return this.dek.slice();
  }

  protected static async readHeader(storage: StoragePort): Promise<VaultHeader> {
    const raw = (await storage.get([HEADER_KEY]))[HEADER_KEY];
    if (raw === undefined) throw new CoreError("vault-not-found", "No vault found");
    const parsed = headerSchema.safeParse(raw);
    if (!parsed.success) throw new CoreError("vault-corrupt", "Vault header is corrupt");
    return parsed.data;
  }

  protected static passwordSlot(header: VaultHeader): PasswordKeyslot {
    const slot = header.keyslots.find((s): s is PasswordKeyslot => s.kind === "password");
    if (!slot) throw new CoreError("vault-corrupt", "Vault has no password keyslot");
    return slot;
  }

  /**
   * DEK bu kasaya mı ait? Önce index, index yoksa (ör. sync'te henüz gelmemiş) ilk hesap kaydı denenir.
   * null: kontrol edilecek şifreli veri yok (boş kasa) → kabul edilir.
   */
  private async indexOpens(): Promise<boolean | null> {
    const all = await this.deps.storage.get();
    const keys = [
      ...(INDEX_KEY in all ? [INDEX_KEY] : []),
      ...Object.keys(all)
        .filter((k) => k.startsWith(ACCOUNT_PREFIX))
        .sort(),
    ];
    for (const key of keys) {
      const record = encryptedRecordSchema.safeParse(all[key]);
      if (!record.success) continue;
      return (await openBytes(this.dek, record.data, recordAad(key))) !== null;
    }
    return null;
  }

  /**
   * Index'i okur. Yoksa boş index döner. Varsa ama çözülemiyorsa: okuma amaçlı çağrılarda boş index
   * döner (kodlar yine görünür); `strict` (yazma öncesi) çağrılarda `vault-corrupt` fırlatır ki
   * sıralama ve sabitlemeler sessizce silinmesin.
   */
  protected async readIndex({ strict = false }: { strict?: boolean } = {}): Promise<VaultIndex> {
    const raw = (await this.deps.storage.get([INDEX_KEY]))[INDEX_KEY];
    if (raw === undefined) return { ...EMPTY_INDEX };
    const record = encryptedRecordSchema.safeParse(raw);
    const index = record.success
      ? await decryptRecord(this.dek, INDEX_KEY, record.data, indexSchema)
      : null;
    if (index) return index;
    if (strict) throw new CoreError("vault-corrupt", "Vault index cannot be decrypted");
    return { ...EMPTY_INDEX };
  }

  private async writeIndex(index: VaultIndex, extra: Record<string, unknown> = {}): Promise<void> {
    await this.deps.storage.set({
      ...extra,
      [INDEX_KEY]: await encryptRecord(
        this.dek,
        INDEX_KEY,
        index,
        index.updatedAt,
        this.deps.random,
      ),
    });
  }

  private nextUpdatedAt(previous: number): number {
    return Math.max(this.deps.clock.now(), previous + 1);
  }

  async listAccounts(): Promise<VaultListing> {
    const all = await this.deps.storage.get();
    const index = await this.readIndex();

    const tombs = new Map<string, number>();
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(TOMB_PREFIX)) continue;
      const tomb = tombSchema.safeParse(value);
      if (tomb.success) tombs.set(key.slice(TOMB_PREFIX.length), tomb.data.deletedAt);
    }

    const accounts: Account[] = [];
    const unreadable: string[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(ACCOUNT_PREFIX)) continue;
      const id = key.slice(ACCOUNT_PREFIX.length);
      const record = encryptedRecordSchema.safeParse(value);
      if (!record.success) {
        unreadable.push(id);
        continue;
      }
      const deletedAt = tombs.get(id);
      if (deletedAt !== undefined && record.data.updatedAt <= deletedAt) continue;
      const account = await decryptRecord(this.dek, key, record.data, accountSchema);
      if (!account || account.id !== id) {
        unreadable.push(id);
        continue;
      }
      accounts.push(account);
    }

    const position = new Map(index.order.map((id, i) => [id, i]));
    accounts.sort((x, y) => {
      const px = position.get(x.id);
      const py = position.get(y.id);
      if (px !== undefined && py !== undefined) return px - py;
      if (px !== undefined) return -1;
      if (py !== undefined) return 1;
      return x.createdAt - y.createdAt || x.id.localeCompare(y.id);
    });

    const ids = new Set(accounts.map((a) => a.id));
    return {
      accounts,
      pinned: index.pinned.filter((id) => ids.has(id)),
      unreadable: unreadable.sort(),
    };
  }

  async addAccounts(
    inputs: AccountInput[],
  ): Promise<{ added: Account[]; duplicates: AccountInput[] }> {
    const { accounts } = await this.listAccounts();
    const seen = new Set(accounts.map(accountFingerprint));
    const now = this.deps.clock.now();
    const added: Account[] = [];
    const duplicates: AccountInput[] = [];
    const items: Record<string, unknown> = {};

    for (const input of inputs) {
      const normalized = normalizeAccountInput(input);
      const fingerprint = accountFingerprint(normalized);
      if (seen.has(fingerprint)) {
        duplicates.push(input);
        continue;
      }
      seen.add(fingerprint);
      const account: Account = {
        ...normalized,
        id: this.deps.random.uuid(),
        createdAt: now,
        updatedAt: now,
      };
      items[accountKey(account.id)] = await encryptRecord(
        this.dek,
        accountKey(account.id),
        account,
        now,
        this.deps.random,
      );
      added.push(account);
    }
    if (added.length === 0) return { added, duplicates };

    const index = await this.readIndex({ strict: true });
    await this.writeIndex(
      {
        ...index,
        order: [...index.order, ...added.map((a) => a.id)],
        updatedAt: this.nextUpdatedAt(index.updatedAt),
      },
      items,
    );
    return { added, duplicates };
  }

  async addAccount(input: AccountInput): Promise<Account> {
    const { added } = await this.addAccounts([input]);
    const account = added[0];
    if (!account) throw new CoreError("duplicate-account", "This account already exists");
    return account;
  }

  async getAccount(id: string): Promise<Account> {
    const key = accountKey(id);
    const raw = (await this.deps.storage.get([key]))[key];
    const record = encryptedRecordSchema.safeParse(raw);
    if (raw === undefined) throw new CoreError("account-not-found", `Account ${id} not found`);
    if (!record.success) throw new CoreError("vault-corrupt", `Account ${id} is corrupt`);
    const account = await decryptRecord(this.dek, key, record.data, accountSchema);
    if (!account || account.id !== id)
      throw new CoreError("vault-corrupt", `Account ${id} cannot be decrypted`);
    return account;
  }

  private async writeAccount(account: Account): Promise<void> {
    const key = accountKey(account.id);
    await this.deps.storage.set({
      [key]: await encryptRecord(this.dek, key, account, account.updatedAt, this.deps.random),
    });
  }

  async updateAccount(id: string, patch: AccountPatch): Promise<Account> {
    const current = await this.getAccount(id);
    const normalized = normalizeAccountInput({
      ...current,
      ...patch,
      secret: current.secret,
      type: current.type,
    });
    const updated: Account = {
      ...normalized,
      id,
      createdAt: current.createdAt,
      updatedAt: this.nextUpdatedAt(current.updatedAt),
    };
    await this.writeAccount(updated);
    return updated;
  }

  async incrementHotp(id: string): Promise<Account> {
    const current = await this.getAccount(id);
    if (current.type !== "hotp") throw new CoreError("invalid-otp-params", "Not an HOTP account");
    const updated: Account = {
      ...current,
      counter: current.counter + 1,
      updatedAt: this.nextUpdatedAt(current.updatedAt),
    };
    await this.writeAccount(updated);
    return updated;
  }

  async deleteAccount(id: string): Promise<void> {
    const key = accountKey(id);
    const raw = (await this.deps.storage.get([key]))[key];
    if (raw === undefined) throw new CoreError("account-not-found", `Account ${id} not found`);
    const record = encryptedRecordSchema.safeParse(raw);
    const index = await this.readIndex({ strict: true });
    // Tombstone, kaydın kendisinden de yeni olmalı; yoksa eski kopya sync ile geri gelir (spec §7).
    const deletedAt = Math.max(
      this.nextUpdatedAt(index.updatedAt),
      record.success ? record.data.updatedAt + 1 : 0,
    );
    // Önce tombstone + index; sonra kayıt silinir. Arada kesinti olursa tombstone kaydı gizler.
    await this.writeIndex(
      {
        order: index.order.filter((x) => x !== id),
        pinned: index.pinned.filter((x) => x !== id),
        updatedAt: deletedAt,
      },
      { [tombKey(id)]: { deletedAt } },
    );
    await this.deps.storage.remove([key]);
  }

  async reorder(order: string[]): Promise<void> {
    const index = await this.readIndex({ strict: true });
    const { accounts } = await this.listAccounts();
    const known = new Set(accounts.map((a) => a.id));
    const front = [...new Set(order)].filter((id) => known.has(id));
    const rest = accounts.map((a) => a.id).filter((id) => !front.includes(id));
    await this.writeIndex({
      ...index,
      order: [...front, ...rest],
      updatedAt: this.nextUpdatedAt(index.updatedAt),
    });
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const index = await this.readIndex({ strict: true });
    const without = index.pinned.filter((x) => x !== id);
    await this.writeIndex({
      ...index,
      pinned: pinned ? [...without, id] : without,
      updatedAt: this.nextUpdatedAt(index.updatedAt),
    });
  }

  async purgeTombstones(maxAgeMs = TOMBSTONE_TTL_MS): Promise<number> {
    const all = await this.deps.storage.get();
    const cutoff = this.deps.clock.now() - maxAgeMs;
    const expired = Object.entries(all)
      .filter(([key, value]) => {
        if (!key.startsWith(TOMB_PREFIX)) return false;
        const tomb = tombSchema.safeParse(value);
        return tomb.success && tomb.data.deletedAt < cutoff;
      })
      .map(([key]) => key);
    if (expired.length) await this.deps.storage.remove(expired);
    return expired.length;
  }
}
