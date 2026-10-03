import {
  accountFingerprint,
  accountSchema,
  normalizeAccountInput,
  type Account,
  type AccountInput,
} from "../account/account";
import { bytesEqual } from "../encoding/bytes";
import { openBytes } from "../crypto/aes";
import { DEFAULT_ARGON2 } from "../crypto/kdf";
import { CoreError, isCoreError } from "../errors";
import type { StoragePort, VaultDeps } from "../ports";
import {
  ACCOUNT_PREFIX,
  accountKey,
  encryptedRecordSchema,
  HEADER_KEY,
  headerSchema,
  INDEX_KEY,
  indexSchema,
  isNewerVersion,
  SITEMEM_KEY,
  TOMB_PREFIX,
  tombKey,
  tombSchema,
  TOMBSTONE_TTL_MS,
  type EncryptedRecord,
  type VaultGroup,
  type VaultHeader,
  type VaultIndex,
} from "./format";
import {
  createPasswordKeyslot,
  createRecoveryKeyslot,
  openPasswordKeyslot,
  openRecoveryKeyslot,
  type Keyslot,
  type PasswordKeyslot,
  type RecoveryKeyslot,
} from "./keyslot";
import {
  assertFits,
  assertNameFree,
  groupNameKey,
  newGroupId,
  normalizeGroupName,
  withoutGroup,
} from "./groups";
import type { z } from "zod";
import { decryptRecord, encryptRecord, recordAad } from "./records";
import { TrashStore, trashItemOf, type TrashItem } from "./trash";
import { generateRecoveryCode, parseRecoveryCode } from "./recovery";

export interface CreateVaultOptions {
  password: string;
  createRecoveryCode: boolean;
}

export interface VaultListing {
  accounts: Account[];
  pinned: string[];
  unreadable: string[];
  /** `vault:index` exists but cannot be decrypted; writes are rejected with `vault-corrupt` until `rebuildIndex()` runs. */
  indexDamaged: boolean;
  groups: VaultGroup[];
}

export type AccountPatch = Partial<
  Pick<AccountInput, "issuer" | "label" | "domains" | "algorithm" | "digits" | "period">
> & { groupId?: string | null };

const EMPTY_INDEX: VaultIndex = { order: [], pinned: [], updatedAt: 0 };

/**
 * Per-storage mutation queue. Bound to the StoragePort, not the Vault instance: the host (service worker)
 * may build a new Vault via `fromKey` on every wake-up, and all instances over the same storage share
 * one order. The chain never rejects; errors only propagate to the caller.
 */
const storageLocks = new WeakMap<StoragePort, Promise<unknown>>();

function withStorageLock<T>(storage: StoragePort, fn: () => Promise<T>): Promise<T> {
  const previous = storageLocks.get(storage) ?? Promise.resolve();
  const run = previous.then(fn);
  storageLocks.set(
    storage,
    run.catch(() => undefined),
  );
  return run;
}

export interface VaultInspection {
  status: "missing" | "ok" | "unsupported" | "corrupt";
  hasRecoveryCode: boolean | null;
  accountCount: number | null;
}

function cleanGroupName(raw: string): string | undefined {
  try {
    return normalizeGroupName(raw);
  } catch (e) {
    if (isCoreError(e, "invalid-group-name")) return undefined;
    throw e;
  }
}

function assertDeviceKey(key: string): void {
  if (!key.startsWith("lock:")) throw new Error("Device records must use a lock: key");
}

export class Vault {
  private constructor(
    private readonly deps: VaultDeps,
    private readonly dek: Uint8Array,
    private header: VaultHeader,
  ) {}

  get vaultId(): string {
    return this.header.vaultId;
  }

  /** Copy of the header as last written (plaintext keyslots only), for keeping backups in step. */
  get headerSnapshot(): unknown {
    return structuredClone(this.header);
  }

  static async exists(storage: StoragePort): Promise<boolean> {
    return HEADER_KEY in (await storage.get([HEADER_KEY]));
  }

  /**
   * Plaintext-only status check; never unlocks. accountCount is an unauthenticated estimate from
   * plaintext timestamps (listAccounts is authoritative), for display only.
   */
  static async inspect(storage: StoragePort): Promise<VaultInspection> {
    try {
      const header = await Vault.readHeader(storage);
      const all = await storage.get();
      // A newer record would make listAccounts/export refuse, so the vault is not usable either.
      for (const [key, value] of Object.entries(all)) {
        if ((key === INDEX_KEY || key.startsWith(ACCOUNT_PREFIX)) && isNewerVersion(value, "v"))
          throw new CoreError("unsupported-format", "Newer vault record");
      }
      const tombs = new Map<string, number>();
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(TOMB_PREFIX)) continue;
        const tomb = tombSchema.safeParse(value);
        if (tomb.success) tombs.set(key.slice(TOMB_PREFIX.length), tomb.data.deletedAt);
      }
      let accountCount = 0;
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(ACCOUNT_PREFIX)) continue;
        const record = encryptedRecordSchema.safeParse(value);
        if (!record.success) continue;
        const deletedAt = tombs.get(key.slice(ACCOUNT_PREFIX.length));
        if (deletedAt !== undefined && record.data.updatedAt <= deletedAt) continue;
        accountCount++;
      }
      return {
        status: "ok",
        hasRecoveryCode: header.keyslots.some((s) => s.kind === "recovery"),
        accountCount,
      };
    } catch (e) {
      const none = { hasRecoveryCode: null, accountCount: null };
      if (e instanceof CoreError) {
        if (e.code === "vault-not-found") return { status: "missing", ...none };
        if (e.code === "unsupported-format") return { status: "unsupported", ...none };
        if (e.code === "vault-corrupt") return { status: "corrupt", ...none };
      }
      throw e;
    }
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
    const indexRecord = await encryptRecord(dek, INDEX_KEY, index, now, deps.random);
    await withStorageLock(deps.storage, async () => {
      if (await Vault.exists(deps.storage))
        throw new CoreError("vault-exists", "A vault already exists");
      await deps.storage.set({ [HEADER_KEY]: header, [INDEX_KEY]: indexRecord });
    });
    return { vault: new Vault(deps, dek, header), recoveryCode };
  }

  static async unlockWithPassword(deps: VaultDeps, password: string): Promise<Vault> {
    const header = await Vault.readHeader(deps.storage);
    const dek = await openPasswordKeyslot(Vault.passwordSlot(header), password, header.vaultId);
    if (!dek) throw new CoreError("wrong-password", "Wrong password");
    return new Vault(deps, dek, header);
  }

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

  static async unlockWithRecovery(
    deps: VaultDeps,
    code: string,
    newPassword: string,
  ): Promise<{ vault: Vault; recoveryCode: string }> {
    const secret = parseRecoveryCode(code);
    const header = await Vault.readHeader(deps.storage);
    const slot = header.keyslots.find((s): s is RecoveryKeyslot => s.kind === "recovery");
    if (!slot) throw new CoreError("invalid-recovery-code", "This vault has no recovery code");
    const dek = await openRecoveryKeyslot(slot, secret, header.vaultId);
    if (!dek) throw new CoreError("invalid-recovery-code", "Recovery code is not correct");
    const vault = new Vault(deps, dek, header);
    const passwordSlot = await vault.buildPasswordSlot(newPassword);
    const recovery = generateRecoveryCode(deps.random);
    const recoverySlot = await createRecoveryKeyslot(
      dek,
      recovery.secret,
      header.vaultId,
      deps.random,
    );
    await withStorageLock(deps.storage, async () => {
      // While waiting for the lock, another call may have used the same code.
      const current = await Vault.readHeader(deps.storage);
      const stillValid = current.keyslots.some(
        (s) => s.kind === "recovery" && s.iv === slot.iv && s.ct === slot.ct,
      );
      if (!stillValid)
        throw new CoreError("invalid-recovery-code", "Recovery code was already used");
      await vault.replaceKeyslots({ password: passwordSlot, recovery: recoverySlot });
    });
    const recoveryCode = recovery.code;
    return { vault, recoveryCode };
  }

  async verifyPassword(password: string): Promise<boolean> {
    const header = await Vault.readHeader(this.deps.storage);
    const dek = await openPasswordKeyslot(Vault.passwordSlot(header), password, header.vaultId);
    return dek !== null && bytesEqual(dek, this.dek);
  }

  /** Serializes all mutations on the same storage. Public mutations must not be called from inside. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return withStorageLock(this.deps.storage, fn);
  }

  /** Must be called while holding the lock. */
  private async replaceKeyslots(
    replacements: Partial<Record<Keyslot["kind"], Keyslot | null>>,
  ): Promise<void> {
    const header = await Vault.readHeader(this.deps.storage);
    if (header.vaultId !== this.header.vaultId) {
      throw new CoreError("vault-corrupt", "Stored vault header belongs to a different vault");
    }
    const replaced = Object.keys(replacements);
    const keyslots: Keyslot[] = header.keyslots.filter((s) => !replaced.includes(s.kind));
    for (const slot of Object.values(replacements)) if (slot) keyslots.push(slot);
    keyslots.sort((a, b) => (a.kind === "password" ? -1 : b.kind === "password" ? 1 : 0));
    const updated: VaultHeader = { ...header, keyslots };
    await this.deps.storage.set({ [HEADER_KEY]: updated });
    this.header = updated;
  }

  private buildPasswordSlot(newPassword: string): Promise<Keyslot> {
    return createPasswordKeyslot(
      this.dek,
      newPassword,
      this.header.vaultId,
      this.deps.random,
      this.deps.kdf ?? DEFAULT_ARGON2,
    );
  }

  async changePassword(newPassword: string): Promise<void> {
    // Slow KDF runs outside the lock; the header read-modify-write runs inside it.
    const password = await this.buildPasswordSlot(newPassword);
    await this.exclusive(() => this.replaceKeyslots({ password }));
  }

  hasRecoveryCode(): boolean {
    return this.header.keyslots.some((s) => s.kind === "recovery");
  }

  async createRecoveryCode(): Promise<string> {
    const recovery = generateRecoveryCode(this.deps.random);
    const slot = await createRecoveryKeyslot(
      this.dek,
      recovery.secret,
      this.header.vaultId,
      this.deps.random,
    );
    await this.exclusive(() => this.replaceKeyslots({ recovery: slot }));
    return recovery.code;
  }

  async removeRecoveryCode(): Promise<void> {
    await this.exclusive(() => this.replaceKeyslots({ recovery: null }));
  }

  exportKey(): Uint8Array {
    return this.dek.slice();
  }

  /** Device-local record sealed under this vault's DEK. Only `lock:` keys: the AAD namespace is shared with trash. */
  async sealDeviceRecord(key: string, value: unknown): Promise<EncryptedRecord> {
    assertDeviceKey(key);
    return encryptRecord(this.dek, key, value, this.deps.clock.now(), this.deps.random);
  }

  /** Every failure (junk, other DEK, other key, schema) is null; the caller fails closed. */
  async openDeviceRecord<T>(key: string, raw: unknown, schema: z.ZodType<T>): Promise<T | null> {
    assertDeviceKey(key);
    const record = encryptedRecordSchema.safeParse(raw);
    return record.success ? decryptRecord(this.dek, key, record.data, schema) : null;
  }

  protected static async readHeader(storage: StoragePort): Promise<VaultHeader> {
    const raw = (await storage.get([HEADER_KEY]))[HEADER_KEY];
    if (raw === undefined) throw new CoreError("vault-not-found", "No vault found");
    if (isNewerVersion(raw, "format"))
      throw new CoreError("unsupported-format", "This vault was created by a newer version");
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
   * Does the DEK belong to this vault? Tries the index first, then account records; one that opens is enough
   * (the index may be corrupt or not yet synced). false: records exist but none opened.
   * null: nothing encrypted to check (empty vault) -> accepted.
   */
  private async indexOpens(): Promise<boolean | null> {
    const all = await this.deps.storage.get();
    const keys = [
      ...(INDEX_KEY in all ? [INDEX_KEY] : []),
      ...Object.keys(all)
        .filter((k) => k.startsWith(ACCOUNT_PREFIX))
        .sort(),
    ];
    let parsedAny = false;
    for (const key of keys) {
      const record = encryptedRecordSchema.safeParse(all[key]);
      if (!record.success) continue;
      parsedAny = true;
      if ((await openBytes(this.dek, record.data, recordAad(key))) !== null) return true;
    }
    return parsedAny ? false : null;
  }

  /** Opens the raw index value. undefined: no index; null: present but undecryptable (damaged). */
  private async openIndex(raw: unknown): Promise<VaultIndex | null | undefined> {
    if (raw === undefined) return undefined;
    if (isNewerVersion(raw, "v"))
      throw new CoreError("unsupported-format", "Vault index was written by a newer version");
    const record = encryptedRecordSchema.safeParse(raw);
    return record.success ? decryptRecord(this.dek, INDEX_KEY, record.data, indexSchema) : null;
  }

  /**
   * Reads the index. Missing -> empty index. Present but undecryptable: read-only callers get an empty index
   * (codes stay visible); `strict` callers (before writes) throw `vault-corrupt` so
   * ordering and pins are not silently wiped.
   */
  protected async readIndex({ strict = false }: { strict?: boolean } = {}): Promise<VaultIndex> {
    const index = await this.openIndex((await this.deps.storage.get([INDEX_KEY]))[INDEX_KEY]);
    if (index === undefined) return { ...EMPTY_INDEX };
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
    const opened = await this.openIndex(all[INDEX_KEY]);
    const index = opened ?? EMPTY_INDEX;
    const groups = index.groups ?? [];
    const knownGroups = new Set(groups.map((g) => g.id));

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
      // Record from a newer client: this version must not touch the vault (it must not be deleted for being unreadable).
      if (isNewerVersion(value, "v"))
        throw new CoreError("unsupported-format", "Vault contains records from a newer version");
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
      // The outer updatedAt is not covered by the AAD, so an old ciphertext could be replayed. The verified inner value must also be newer than the tombstone.
      if (deletedAt !== undefined && account.updatedAt <= deletedAt) continue;
      // A groupId missing from the index (rebuilt or damaged) reads as ungrouped.
      accounts.push(
        account.groupId && !knownGroups.has(account.groupId) ? withoutGroup(account) : account,
      );
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
      indexDamaged: opened === null,
      groups,
    };
  }

  /**
   * Writes a fresh index without reading the damaged one: order is createdAt/id of the readable accounts,
   * pins are empty. Unblocks writes locked out by a corrupt index.
   */
  rebuildIndex(): Promise<void> {
    return this.exclusive(async () => {
      const { accounts } = await this.listAccounts();
      const order = [...accounts]
        .sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id))
        .map((a) => a.id);
      await this.writeIndex({ order, pinned: [], updatedAt: this.nextUpdatedAt(0) });
    });
  }

  addAccounts(inputs: AccountInput[]): Promise<{ added: Account[]; duplicates: AccountInput[] }> {
    return this.exclusive(() => this.addAccountsUnlocked(inputs));
  }

  /**
   * Adds accounts and files them under groups by name in one write. Missing groups are created
   * (matched by groupNameKey); past the group limits the rest land ungrouped and are counted.
   */
  addAccountsWithGroups(
    inputs: AccountInput[],
    names: (string | undefined)[],
    orderedNames: string[],
  ): Promise<{ added: Account[]; duplicates: AccountInput[]; ungrouped: number }> {
    return this.exclusive(() => this.addAccountsUnlocked(inputs, { names, orderedNames }));
  }

  private async addAccountsUnlocked(
    inputs: AccountInput[],
    grouping?: { names: (string | undefined)[]; orderedNames: string[] },
  ): Promise<{ added: Account[]; duplicates: AccountInput[]; ungrouped: number }> {
    const { accounts } = await this.listAccounts();
    const seen = new Set(accounts.map(accountFingerprint));
    const now = this.deps.clock.now();
    const added: Account[] = [];
    const duplicates: AccountInput[] = [];
    const items: Record<string, unknown> = {};
    const accepted: { account: Account; name: string | undefined }[] = [];

    for (const [i, input] of inputs.entries()) {
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
      accepted.push({ account, name: grouping?.names[i] });
    }
    if (accepted.length === 0) return { added, duplicates, ungrouped: 0 };

    const index = await this.readIndex({ strict: true });
    let groups = index.groups ?? [];
    let ungrouped = 0;
    if (grouping) {
      const byKey = new Map<string, string | null>();
      for (const g of groups) byKey.set(groupNameKey(g.name), g.id);
      const used = new Map<string, string>();
      for (const { name } of accepted) {
        const clean = name === undefined ? undefined : cleanGroupName(name);
        if (clean !== undefined) used.set(groupNameKey(clean), clean);
      }
      const candidates: string[] = [];
      for (const raw of [...grouping.orderedNames, ...used.values()]) {
        const clean = cleanGroupName(raw);
        if (clean !== undefined) candidates.push(clean);
      }
      for (const clean of candidates) {
        const key = groupNameKey(clean);
        if (!used.has(key) || byKey.has(key)) continue;
        const next = [...groups, { id: newGroupId(this.deps.random, groups), name: clean }];
        try {
          assertFits(next);
        } catch (e) {
          if (!isCoreError(e, "group-limit")) throw e;
          byKey.set(key, null);
          continue;
        }
        groups = next;
        byKey.set(key, next[next.length - 1]!.id);
      }
      for (const entry of accepted) {
        const clean = entry.name === undefined ? undefined : cleanGroupName(entry.name);
        if (clean === undefined) {
          if (entry.name !== undefined) ungrouped++;
          continue;
        }
        const id = byKey.get(groupNameKey(clean));
        if (id) entry.account.groupId = id;
        else ungrouped++;
      }
    }

    for (const { account } of accepted) {
      items[accountKey(account.id)] = await encryptRecord(
        this.dek,
        accountKey(account.id),
        account,
        now,
        this.deps.random,
      );
      added.push(account);
    }
    await this.writeIndex(
      {
        ...index,
        ...(grouping ? { groups } : {}),
        order: [...index.order, ...added.map((a) => a.id)],
        updatedAt: this.nextUpdatedAt(index.updatedAt),
      },
      items,
    );
    return { added, duplicates, ungrouped };
  }

  async addAccount(input: AccountInput): Promise<Account> {
    const { added } = await this.exclusive(() => this.addAccountsUnlocked([input]));
    const account = added[0];
    if (!account) throw new CoreError("duplicate-account", "This account already exists");
    return account;
  }

  async getAccount(id: string): Promise<Account> {
    const key = accountKey(id);
    const raw = (await this.deps.storage.get([key]))[key];
    const record = encryptedRecordSchema.safeParse(raw);
    if (raw === undefined) throw new CoreError("account-not-found", `Account ${id} not found`);
    if (isNewerVersion(raw, "v"))
      throw new CoreError("unsupported-format", `Account ${id} was written by a newer version`);
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

  // A tombstone newer than the record means the account was deleted; a stale copy must not be re-sealed over it.
  private async getLiveAccount(id: string): Promise<Account> {
    const current = await this.getAccount(id);
    const tomb = tombSchema.safeParse((await this.deps.storage.get([tombKey(id)]))[tombKey(id)]);
    if (tomb.success && current.updatedAt <= tomb.data.deletedAt)
      throw new CoreError("account-not-found", `Account ${id} not found`);
    return current;
  }

  updateAccount(id: string, patch: AccountPatch): Promise<Account> {
    return this.exclusive(async () => {
      const current = await this.getLiveAccount(id);
      const { groupId: patchGroup, ...fields } = patch;
      let groupId = current.groupId;
      if (patchGroup === null) groupId = undefined;
      else if (patchGroup !== undefined) {
        const index = await this.readIndex({ strict: true });
        if (!(index.groups ?? []).some((g) => g.id === patchGroup))
          throw new CoreError("group-not-found", "Group not found");
        groupId = patchGroup;
      }
      // normalizeAccountInput whitelists fields, so groupId is re-added explicitly.
      const normalized = normalizeAccountInput({
        ...current,
        ...fields,
        secret: current.secret,
        type: current.type,
      });
      const updated: Account = {
        ...normalized,
        id,
        createdAt: current.createdAt,
        updatedAt: this.nextUpdatedAt(current.updatedAt),
        ...(groupId ? { groupId } : {}),
      };
      await this.writeAccount(updated);
      return updated;
    });
  }

  incrementHotp(id: string): Promise<Account> {
    return this.exclusive(async () => {
      const current = await this.getLiveAccount(id);
      if (current.type !== "hotp") throw new CoreError("invalid-otp-params", "Not an HOTP account");
      const updated: Account = {
        ...current,
        counter: current.counter + 1,
        updatedAt: this.nextUpdatedAt(current.updatedAt),
      };
      await this.writeAccount(updated);
      return updated;
    });
  }

  deleteAccount(id: string): Promise<void> {
    return this.exclusive(async () => {
      const key = accountKey(id);
      const raw = (await this.deps.storage.get([key]))[key];
      if (raw === undefined) throw new CoreError("account-not-found", `Account ${id} not found`);
      if (isNewerVersion(raw, "v"))
        throw new CoreError("unsupported-format", "This account was saved by a newer version");
      const record = encryptedRecordSchema.safeParse(raw);
      const index = await this.readIndex({ strict: true });
      // The tombstone must be newer than the record itself, or the old copy comes back via sync.
      const deletedAt = Math.max(
        this.nextUpdatedAt(index.updatedAt),
        record.success ? record.data.updatedAt + 1 : 0,
      );
      const trashed = await this.moveToTrash(id, record.success ? record.data : null);
      // Tombstone + index first, then delete the record. If interrupted in between, the tombstone hides the record.
      try {
        await this.writeIndex(
          {
            ...index,
            order: index.order.filter((x) => x !== id),
            pinned: index.pinned.filter((x) => x !== id),
            updatedAt: deletedAt,
          },
          { [tombKey(id)]: { deletedAt } },
        );
      } catch (e) {
        // Nothing was deleted, so a bin entry would show a live account as deleted.
        if (trashed) await this.trashStore()?.drop(id);
        throw e;
      }
      await this.deps.storage.remove([key]);
    });
  }

  private trashStore(): TrashStore | null {
    const { trash, random, clock } = this.deps;
    return trash ? new TrashStore(trash, this.dek, random, clock) : null;
  }

  /** Never throws: a full or failing bin must not block the delete. */
  private async moveToTrash(id: string, record: EncryptedRecord | null): Promise<boolean> {
    const store = this.trashStore();
    if (!store || !record) return false;
    try {
      const account = await decryptRecord(this.dek, accountKey(id), record, accountSchema);
      if (!account || account.id !== id) return false;
      const tomb = tombSchema.safeParse((await this.deps.storage.get([tombKey(id)]))[tombKey(id)]);
      if (tomb.success && account.updatedAt <= tomb.data.deletedAt) return false;
      return await store.put(account);
    } catch {
      return false;
    }
  }

  private async liveIds(): Promise<Set<string>> {
    return new Set((await this.listAccounts()).accounts.map((a) => a.id));
  }

  async listTrash(): Promise<TrashItem[]> {
    const store = this.trashStore();
    return store ? (await store.list(await this.liveIds())).map(trashItemOf) : [];
  }

  /** Restores under a fresh id: the old id keeps its tombstone, so no offline copy can resurrect with it. */
  restoreFromTrash(id: string, opts?: { allowDuplicate?: boolean }): Promise<Account> {
    return this.exclusive(async () => {
      const store = this.trashStore();
      if (!store) throw new CoreError("trash-entry-not-found", "Not in recently deleted");
      const entry = await store.open(id);
      const index = await this.readIndex({ strict: true });
      const { accounts } = await this.listAccounts();
      const fingerprint = accountFingerprint(entry.account);
      if (!opts?.allowDuplicate && accounts.some((a) => accountFingerprint(a) === fingerprint))
        throw new CoreError("duplicate-account", "This account already exists");
      const keepGroup =
        entry.account.groupId !== undefined &&
        (index.groups ?? []).some((g) => g.id === entry.account.groupId);
      const updatedAt = this.nextUpdatedAt(index.updatedAt);
      const restored: Account = {
        ...(keepGroup ? entry.account : withoutGroup(entry.account)),
        id: this.deps.random.uuid(),
        updatedAt,
      };
      const key = accountKey(restored.id);
      await this.writeIndex(
        { ...index, order: [...index.order, restored.id], updatedAt },
        { [key]: await encryptRecord(this.dek, key, restored, updatedAt, this.deps.random) },
      );
      // The account is back; a failed cleanup must not turn that into an error.
      await store.drop(id);
      return restored;
    });
  }

  purgeTrashEntry(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.trashStore()?.drop(id);
    });
  }

  emptyTrash(): Promise<number> {
    return this.exclusive(async () => (await this.trashStore()?.clear()) ?? 0);
  }

  purgeExpiredTrash(): Promise<number> {
    return this.exclusive(async () => {
      const store = this.trashStore();
      // Runs on unlock: a newer-version record must not make cleanup throw.
      return store ? store.purgeExpired(await this.liveIds().catch(() => new Set<string>())) : 0;
    });
  }

  createGroup(name: string): Promise<VaultGroup> {
    return this.exclusive(async () => {
      const index = await this.readIndex({ strict: true });
      const groups = index.groups ?? [];
      const clean = normalizeGroupName(name);
      assertNameFree(groups, clean);
      const group = { id: newGroupId(this.deps.random, groups), name: clean };
      const next = [...groups, group];
      assertFits(next);
      await this.writeIndex({
        ...index,
        groups: next,
        updatedAt: this.nextUpdatedAt(index.updatedAt),
      });
      return group;
    });
  }

  renameGroup(id: string, name: string): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.readIndex({ strict: true });
      const groups = index.groups ?? [];
      if (!groups.some((g) => g.id === id))
        throw new CoreError("group-not-found", "Group not found");
      const clean = normalizeGroupName(name);
      assertNameFree(groups, clean, id);
      const next = groups.map((g) => (g.id === id ? { ...g, name: clean } : g));
      assertFits(next);
      await this.writeIndex({
        ...index,
        groups: next,
        updatedAt: this.nextUpdatedAt(index.updatedAt),
      });
    });
  }

  deleteGroup(id: string): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.readIndex({ strict: true });
      const groups = index.groups ?? [];
      if (!groups.some((g) => g.id === id))
        throw new CoreError("group-not-found", "Group not found");
      const { accounts } = await this.listAccounts();
      const updatedAt = this.nextUpdatedAt(index.updatedAt);
      // One write for members and index: atomic, and a single sync operation.
      const items: Record<string, unknown> = {};
      for (const account of accounts) {
        if (account.groupId !== id) continue;
        const cleaned = {
          ...withoutGroup(account),
          updatedAt: this.nextUpdatedAt(account.updatedAt),
        };
        items[accountKey(account.id)] = await encryptRecord(
          this.dek,
          accountKey(account.id),
          cleaned,
          cleaned.updatedAt,
          this.deps.random,
        );
      }
      await this.writeIndex(
        { ...index, groups: groups.filter((g) => g.id !== id), updatedAt },
        items,
      );
    });
  }

  reorderGroups(ids: string[]): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.readIndex({ strict: true });
      const groups = index.groups ?? [];
      const byId = new Map(groups.map((g) => [g.id, g]));
      const front = [...new Set(ids)].filter((x) => byId.has(x));
      const rest = groups.map((g) => g.id).filter((x) => !front.includes(x));
      await this.writeIndex({
        ...index,
        groups: [...front, ...rest].map((x) => byId.get(x)!),
        updatedAt: this.nextUpdatedAt(index.updatedAt),
      });
    });
  }

  reorder(order: string[]): Promise<void> {
    return this.exclusive(async () => {
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
    });
  }

  moveAccount(id: string, groupId: string | null, beforeId: string | null): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.getLiveAccount(id);
      const index = await this.readIndex({ strict: true });
      const known = new Set((index.groups ?? []).map((g) => g.id));
      if (groupId !== null && !known.has(groupId))
        throw new CoreError("group-not-found", "Group not found");
      const { accounts } = await this.listAccounts();
      if (!accounts.some((a) => a.id === id))
        throw new CoreError("account-not-found", `Account ${id} not found`);
      // Listed rows are already cleaned of unknown groups; the raw record is not.
      const groupOf = (a: { groupId?: string }) => a.groupId ?? null;
      const currentGroup = current.groupId && known.has(current.groupId) ? current.groupId : null;

      const rest = accounts.filter((a) => a.id !== id);
      let order: string[];
      if (beforeId === id) {
        order = accounts.map((a) => a.id);
      } else {
        const before = beforeId === null ? undefined : rest.find((a) => a.id === beforeId);
        let at: number;
        if (before && groupOf(before) === groupId) at = rest.indexOf(before);
        else {
          let last = -1;
          rest.forEach((a, i) => {
            if (groupOf(a) === groupId) last = i;
          });
          at = last < 0 ? rest.length : last + 1;
        }
        order = rest.map((a) => a.id);
        order.splice(at, 0, id);
      }

      const extra: Record<string, unknown> = {};
      if (currentGroup !== groupId) {
        const next: Account = {
          ...withoutGroup(current),
          updatedAt: this.nextUpdatedAt(current.updatedAt),
          ...(groupId ? { groupId } : {}),
        };
        const key = accountKey(id);
        extra[key] = await encryptRecord(this.dek, key, next, next.updatedAt, this.deps.random);
      }
      // One write: a failure leaves both the record and the order untouched.
      await this.writeIndex(
        { ...index, order, updatedAt: this.nextUpdatedAt(index.updatedAt) },
        extra,
      );
    });
  }

  setPinned(id: string, pinned: boolean): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.readIndex({ strict: true });
      const without = index.pinned.filter((x) => x !== id);
      await this.writeIndex({
        ...index,
        pinned: pinned ? [...without, id] : without,
        updatedAt: this.nextUpdatedAt(index.updatedAt),
      });
    });
  }

  private async hiddenBy(key: string, raw: unknown, deletedAt: number): Promise<boolean> {
    const record = encryptedRecordSchema.safeParse(raw);
    if (!record.success) return false;
    if (record.data.updatedAt <= deletedAt) return true;
    const account = await decryptRecord(this.dek, key, record.data, accountSchema);
    return account !== null && account.updatedAt <= deletedAt;
  }

  // Legacy (<=0.0.x) record: removed without decrypting; reads first so a clean vault costs no sync write.
  clearSiteMemory(): Promise<void> {
    return this.exclusive(async () => {
      if ((await this.deps.storage.get([SITEMEM_KEY]))[SITEMEM_KEY] !== undefined) {
        await this.deps.storage.remove([SITEMEM_KEY]);
      }
    });
  }

  purgeTombstones(maxAgeMs = TOMBSTONE_TTL_MS): Promise<number> {
    return this.exclusive(async () => {
      const all = await this.deps.storage.get();
      const cutoff = this.deps.clock.now() - maxAgeMs;
      const toRemove: string[] = [];
      let purged = 0;
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(TOMB_PREFIX)) continue;
        const tomb = tombSchema.safeParse(value);
        if (!tomb.success || tomb.data.deletedAt >= cutoff) continue;
        purged++;
        toRemove.push(key);
        // An old copy hidden by the tombstone must go too, or it resurrects once the tombstone is removed.
        const recordKey = accountKey(key.slice(TOMB_PREFIX.length));
        if (await this.hiddenBy(recordKey, all[recordKey], tomb.data.deletedAt))
          toRemove.push(recordKey);
      }
      if (toRemove.length) await this.deps.storage.remove(toRemove);
      return purged;
    });
  }
}
