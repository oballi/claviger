import { openBytes } from "../crypto/aes";
import { DEFAULT_ARGON2 } from "../crypto/kdf";
import { CoreError } from "../errors";
import type { StoragePort, VaultDeps } from "../ports";
import {
  ACCOUNT_PREFIX,
  encryptedRecordSchema,
  HEADER_KEY,
  headerSchema,
  INDEX_KEY,
  indexSchema,
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
    const candidates = Object.keys(all)
      .filter((k) => k === INDEX_KEY || k.startsWith(ACCOUNT_PREFIX))
      .sort();
    for (const key of candidates) {
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
}
