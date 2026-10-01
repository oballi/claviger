import {
  buildImportPreview,
  CLOCK_OFFSET_THRESHOLD_SEC,
  computeClockOffset,
  exportOtpauthText,
  exportOtpvault,
  generateCode,
  isVaultKey,
  moveVaultData,
  parseImport,
  toOtpauthUri,
  isCoreError,
  matchAccounts,
  normalizeAccountInput,
  parseOtpauthUri,
  registrableDomain,
  Vault,
  type Account,
  type AccountDraft,
  type AccountInput,
  type AccountPatch,
  type ImportFormat,
  type ImportIssue,
  type StoragePort,
  type VaultDeps,
} from "@otp-vault/core";
import type { Platform, StorageAreaName } from "../platform/ports";
import { ServiceError } from "./errors";
import { KeyCache, MANUAL_LOCK_KEY, PERSISTED_KEY } from "./keyCache";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type LockPolicy,
  type Settings,
} from "./settings";
import { Throttle } from "./throttle";

export const AUTOLOCK_ALARM = "autolock";
export const MIN_PASSWORD_LENGTH = 8;
export const TOKEN_TTL_MS = 60_000;
export const PREVIEW_TTL_MS = 10 * 60_000;
export const MAX_CLOCK_OFFSET_SEC = 12 * 3600;
export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_ITEM_QUOTA_BYTES = 8_192;

/** storage.sync counts quota as key length plus JSON-encoded value length. */
const itemBytes = (key: string, value: unknown) => key.length + JSON.stringify(value).length;

export type ServiceStatus = "no-vault" | "locked" | "unlocked" | "unsupported" | "corrupt";

export interface ServiceState {
  status: ServiceStatus;
  lockPolicy: LockPolicy;
  storageArea: StorageAreaName;
  /** Known while locked too (read from the plaintext header); null when there is no readable vault. */
  hasRecoveryCode: boolean | null;
  /** Live account records, counted without decrypting; null when there is no readable vault. */
  accountCount: number | null;
  retryAfterMs: number;
  clockOffsetSec: number;
  clockCheckEnabled: boolean;
  revealRequiresPassword: boolean;
  lastBackupAt: number | null;
}

export interface AccountView {
  id: string;
  type: Account["type"];
  issuer: string;
  label: string;
  algorithm: Account["algorithm"];
  digits: number;
  period: number;
  domains: string[];
  pinned: boolean;
  code: string;
  remaining: number | null;
}

export interface AccountListView {
  accounts: AccountView[];
  unreadable: string[];
  indexDamaged: boolean;
  matches: { exact: string[]; suggested: string[] };
}

export interface ImportPreviewItemView {
  index: number;
  issuer: string;
  label: string;
  type: Account["type"];
  status: "new" | "duplicate";
}

export type ImportPreviewView =
  | {
      status: "ok";
      previewId: string;
      format: ImportFormat;
      items: ImportPreviewItemView[];
      issues: ImportIssue[];
    }
  | { status: "needs-password"; format: ImportFormat }
  | { status: "unrecognized" };

export interface StorageUsageView {
  area: StorageAreaName;
  bytes: number;
  indexBytes: number;
  quotaBytes: number | null;
  maxItemBytes: number | null;
}

export function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ServiceError(
      "invalid-request",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Single writer for the vault. In-memory state is never trusted: a restarted service worker rebuilds it from KeyCache. */
export class VaultService {
  protected vault: Vault | null = null;
  protected readonly keys: KeyCache;
  protected readonly throttle: Throttle;
  private queue: Promise<unknown> = Promise.resolve();
  // Bumped by lock() so async work that started before it cannot reinstate an unlocked vault.
  private lockEpoch = 0;
  private loading: Promise<Vault | null> | null = null;
  private readonly tokens = new Map<string, number>();
  private readonly previews = new Map<string, { accounts: AccountInput[]; expiresAt: number }>();

  constructor(protected readonly p: Platform) {
    this.keys = new KeyCache(p);
    this.throttle = new Throttle(p.local, p.clock);
  }

  /**
   * Service-wide write queue; also covers storage-area moves, which span two stores.
   * The chain never rejects: errors only reach the caller. Never nest calls (deadlock).
   */
  protected exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  protected settings(): Promise<Settings> {
    return loadSettings(this.p.local);
  }

  protected area(name: StorageAreaName): StoragePort {
    return name === "sync" ? this.p.sync : this.p.local;
  }

  protected deps(storage: StoragePort): VaultDeps {
    return { storage, random: this.p.random, clock: this.p.clock, kdf: this.p.kdf };
  }

  /** Adopts a vault in the other area (sync arrival on a new device, or an interrupted area move). */
  private async locateVault(): Promise<{ settings: Settings; exists: boolean }> {
    let settings = await this.settings();
    if (await Vault.exists(this.area(settings.storageArea))) return { settings, exists: true };
    const other: StorageAreaName = settings.storageArea === "local" ? "sync" : "local";
    if (await Vault.exists(this.area(other))) {
      settings = await saveSettings(this.p.local, { storageArea: other });
      return { settings, exists: true };
    }
    return { settings, exists: false };
  }

  private ensureLoaded(): Promise<Vault | null> {
    if (this.vault) return Promise.resolve(this.vault);
    if (this.loading) return this.loading;
    const load: Promise<Vault | null> = this.loadFromCache(this.lockEpoch).finally(() => {
      if (this.loading === load) this.loading = null;
    });
    this.loading = load;
    return load;
  }

  private async loadFromCache(epoch: number): Promise<Vault | null> {
    // Adopts the right area first: an interrupted move must not make the cached key look wrong.
    const { settings } = await this.locateVault();
    const { storageArea, lockPolicy } = settings;
    const dek = await this.keys.load(lockPolicy);
    if (!dek || epoch !== this.lockEpoch) return null;
    try {
      const vault = await Vault.fromKey(this.deps(this.area(storageArea)), dek);
      if (epoch !== this.lockEpoch) return null;
      this.vault = vault;
      return vault;
    } catch (e) {
      if (isCoreError(e, "wrong-password") || isCoreError(e, "vault-not-found")) {
        // A concurrent unlock may already have stored a good key; forgetting now would erase it.
        if (epoch === this.lockEpoch && !this.vault) await this.keys.forget();
        return null;
      }
      throw e;
    }
  }

  protected async requireVault(): Promise<Vault> {
    const vault = await this.ensureLoaded();
    if (!vault) throw new ServiceError("locked", "The vault is locked");
    await this.touch();
    return vault;
  }

  protected async scheduleAutolock(policy: LockPolicy): Promise<void> {
    if (policy.kind === "timeout") await this.p.alarms.create(AUTOLOCK_ALARM, policy.minutes);
    else await this.p.alarms.clear(AUTOLOCK_ALARM);
  }

  /** In timeout mode every vault interaction restarts the countdown. */
  private async touch(): Promise<void> {
    const { lockPolicy } = await this.settings();
    if (lockPolicy.kind === "timeout")
      await this.p.alarms.create(AUTOLOCK_ALARM, lockPolicy.minutes);
  }

  /** Returns false (and stays locked) if lock() ran since `epoch`; callers decide whether that is an error. */
  private async activate(vault: Vault, policy: LockPolicy, epoch: number): Promise<boolean> {
    if (epoch !== this.lockEpoch) return false;
    this.vault = vault;
    await this.keys.store(vault.exportKey(), policy);
    if (await this.relockIfOvertaken(epoch)) return false;
    await this.throttle.reset();
    await this.scheduleAutolock(policy);
    return true;
  }

  /** KeyCache.store spans several writes; a lock that lands between them would be undone, so redo it. */
  private async relockIfOvertaken(epoch: number): Promise<boolean> {
    if (epoch === this.lockEpoch) return false;
    this.vault = null;
    await this.keys.lock();
    await this.p.local.remove([PERSISTED_KEY]);
    return true;
  }

  protected async checkThrottle(): Promise<void> {
    const wait = await this.throttle.retryAfterMs();
    if (wait > 0)
      throw new ServiceError("throttled", "Too many wrong attempts; try again later", wait);
  }

  protected async failAttempt(): Promise<never> {
    await this.throttle.recordFailure();
    throw new ServiceError("wrong-password", "Wrong password", await this.throttle.retryAfterMs());
  }

  async getState(): Promise<ServiceState> {
    const { settings, exists } = await this.locateVault();
    const base = {
      lockPolicy: settings.lockPolicy,
      storageArea: settings.storageArea,
      clockOffsetSec: settings.clockOffsetSec,
      clockCheckEnabled: settings.clockCheckEnabled,
      revealRequiresPassword: settings.revealRequiresPassword,
      lastBackupAt: settings.lastBackupAt,
      retryAfterMs: await this.throttle.retryAfterMs(),
    };
    const none = { hasRecoveryCode: null, accountCount: null };
    if (!exists) return { ...base, status: "no-vault", ...none };
    let vault: Vault | null;
    try {
      vault = await this.ensureLoaded();
    } catch (e) {
      if (isCoreError(e, "unsupported-format")) return { ...base, status: "unsupported", ...none };
      if (isCoreError(e, "vault-corrupt")) return { ...base, status: "corrupt", ...none };
      throw e;
    }
    // Header-only read: reports unsupported/corrupt, the recovery flag and the count even while locked.
    const info = await Vault.inspect(this.area(settings.storageArea));
    if (info.status === "unsupported" || info.status === "corrupt") {
      return { ...base, status: info.status, ...none };
    }
    if (vault) {
      return {
        ...base,
        status: "unlocked",
        hasRecoveryCode: vault.hasRecoveryCode(),
        accountCount: info.accountCount,
      };
    }
    if (info.status === "missing") return { ...base, status: "no-vault", ...none };
    return {
      ...base,
      status: "locked",
      hasRecoveryCode: info.hasRecoveryCode,
      accountCount: info.accountCount,
    };
  }

  async setup(opts: {
    password: string;
    createRecoveryCode: boolean;
    lockPolicy: LockPolicy;
    storageArea: StorageAreaName;
  }): Promise<{ recoveryCode: string | null }> {
    assertPassword(opts.password);
    return this.exclusive(() => this.doSetup(opts));
  }

  private async doSetup(opts: {
    password: string;
    createRecoveryCode: boolean;
    lockPolicy: LockPolicy;
    storageArea: StorageAreaName;
  }): Promise<{ recoveryCode: string | null }> {
    const epoch = this.lockEpoch;
    if ((await Vault.exists(this.p.local)) || (await Vault.exists(this.p.sync))) {
      throw new ServiceError("already-set-up", "A vault already exists");
    }
    const { vault, recoveryCode } = await Vault.create(this.deps(this.area(opts.storageArea)), {
      password: opts.password,
      createRecoveryCode: opts.createRecoveryCode,
    });
    await saveSettings(this.p.local, {
      lockPolicy: opts.lockPolicy,
      storageArea: opts.storageArea,
    });
    await this.activate(vault, opts.lockPolicy, epoch);
    return { recoveryCode };
  }

  unlock(password: string): Promise<void> {
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      await this.checkThrottle();
      const { settings, exists } = await this.locateVault();
      if (!exists) throw new ServiceError("no-vault", "No vault has been set up");
      let vault: Vault;
      try {
        vault = await Vault.unlockWithPassword(
          this.deps(this.area(settings.storageArea)),
          password,
        );
      } catch (e) {
        if (isCoreError(e, "wrong-password")) return this.failAttempt();
        throw e;
      }
      // A plain unlock persists nothing, so being overtaken by lock() is an error.
      if (!(await this.activate(vault, settings.lockPolicy, epoch))) {
        throw new ServiceError("locked", "The vault was locked meanwhile");
      }
    });
  }

  async unlockWithRecovery(code: string, newPassword: string): Promise<{ recoveryCode: string }> {
    assertPassword(newPassword);
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      await this.checkThrottle();
      const { settings, exists } = await this.locateVault();
      if (!exists) throw new ServiceError("no-vault", "No vault has been set up");
      let result: { vault: Vault; recoveryCode: string };
      try {
        result = await Vault.unlockWithRecovery(
          this.deps(this.area(settings.storageArea)),
          code,
          newPassword,
        );
      } catch (e) {
        if (isCoreError(e, "invalid-recovery-code")) await this.throttle.recordFailure();
        throw e;
      }
      await this.activate(result.vault, settings.lockPolicy, epoch);
      return { recoveryCode: result.recoveryCode };
    });
  }

  async lock(): Promise<void> {
    this.lockEpoch++;
    this.loading = null;
    this.vault = null;
    this.onLock();
    await this.keys.lock();
    await this.p.alarms.clear(AUTOLOCK_ALARM);
  }

  /** Hook for clearing transient in-memory state on lock. */
  protected onLock(): void {
    this.tokens.clear();
    this.previews.clear();
  }

  async handleAlarm(name: string): Promise<void> {
    if (name === AUTOLOCK_ALARM) await this.lock();
  }

  async handleIdleState(
    state: "active" | "idle" | "locked",
    opts: { idleMeansLocked?: boolean } = {},
  ): Promise<void> {
    const { lockPolicy } = await this.settings();
    if (lockPolicy.kind !== "browser-close-or-screen-lock") return;
    if (state === "locked" || (state === "idle" && opts.idleMeansLocked)) await this.lock();
  }

  async listAccounts(opts: { pageUrl?: string } = {}): Promise<AccountListView> {
    const vault = await this.requireVault();
    const { clockOffsetSec } = await this.settings();
    const listing = await vault.listAccounts();
    const now = this.p.clock.now();
    const pinned = new Set(listing.pinned);
    const accounts = await Promise.all(
      listing.accounts.map(async (a): Promise<AccountView> => {
        const generated = await generateCode(a, now, clockOffsetSec);
        return {
          id: a.id,
          type: a.type,
          issuer: a.issuer,
          label: a.label,
          algorithm: a.algorithm,
          digits: a.digits,
          period: a.period,
          domains: a.domains,
          pinned: pinned.has(a.id),
          code: generated.code,
          remaining: generated.remaining,
        };
      }),
    );
    const matches = opts.pageUrl
      ? matchAccounts(listing.accounts, opts.pageUrl)
      : { exact: [] as Account[], suggested: [] as Account[] };
    return {
      accounts,
      unreadable: listing.unreadable,
      indexDamaged: listing.indexDamaged,
      matches: {
        exact: matches.exact.map((a) => a.id),
        suggested: matches.suggested.map((a) => a.id),
      },
    };
  }

  addAccount(
    source: { uri: string } | { draft: AccountDraft },
    opts: { sourceUrl?: string } = {},
  ): Promise<{ id: string }> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      const parsed =
        "uri" in source ? parseOtpauthUri(source.uri) : normalizeAccountInput(source.draft);
      const domain = opts.sourceUrl ? registrableDomain(opts.sourceUrl) : null;
      const input = domain
        ? normalizeAccountInput({ ...parsed, domains: [...parsed.domains, domain] })
        : parsed;
      const account = await vault.addAccount(input);
      return { id: account.id };
    });
  }

  updateAccount(id: string, patch: AccountPatch): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).updateAccount(id, patch);
    });
  }

  deleteAccount(id: string): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).deleteAccount(id);
    });
  }

  reorder(order: string[]): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).reorder(order);
    });
  }

  setPinned(id: string, pinned: boolean): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).setPinned(id, pinned);
    });
  }

  rebuildIndex(): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).rebuildIndex();
    });
  }

  nextHotp(id: string): Promise<{ code: string }> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      const account = await vault.incrementHotp(id);
      return { code: (await generateCode(account, this.p.clock.now())).code };
    });
  }

  // Queued so parallel guesses cannot all pass the throttle check before the first failure is recorded.
  reauth(password: string): Promise<{ token: string }> {
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      const vault = await this.requireVault();
      await this.checkThrottle();
      if (!(await vault.verifyPassword(password))) return this.failAttempt();
      // A token minted across a lock or deletion would outlive the session it was issued for.
      if (epoch !== this.lockEpoch)
        throw new ServiceError("locked", "The vault was locked meanwhile");
      await this.throttle.reset();
      const token = this.p.random.uuid();
      this.tokens.set(token, this.p.clock.now() + TOKEN_TTL_MS);
      return { token };
    });
  }

  /** Sensitive operations need a fresh password confirmation: single use, 60 s (spec section 3.2). */
  private async spendToken(token: string): Promise<Vault> {
    const vault = await this.requireVault();
    const expiresAt = this.tokens.get(token);
    this.tokens.delete(token);
    if (expiresAt === undefined || expiresAt < this.p.clock.now()) {
      throw new ServiceError("invalid-token", "Please confirm your password again");
    }
    return vault;
  }

  async revealSecret(token: string | undefined, id: string): Promise<{ uri: string }> {
    const { revealRequiresPassword } = await this.settings();
    // A token that is passed is always spent, even when the setting would let it be omitted.
    const vault =
      token === undefined && !revealRequiresPassword
        ? await this.requireVault()
        : await this.spendToken(token ?? "");
    return { uri: toOtpauthUri(await vault.getAccount(id)) };
  }

  setRevealRequiresPassword(token: string, value: boolean): Promise<void> {
    return this.exclusive(async () => {
      await this.spendToken(token);
      await saveSettings(this.p.local, { revealRequiresPassword: value });
    });
  }

  async exportVault(
    token: string,
    format: "otpvault" | "otpauth",
    exportPassword?: string,
  ): Promise<{ filename: string; content: string; count: number; skipped: number }> {
    if (format === "otpvault") assertPassword(exportPassword ?? "");
    return this.exclusive(async () => {
      const vault = await this.spendToken(token);
      const { accounts, unreadable } = await vault.listAccounts();
      const date = new Date(this.p.clock.now()).toISOString().slice(0, 10);
      const result =
        format === "otpvault"
          ? {
              filename: `otp-vault-${date}.otpvault`,
              content: await exportOtpvault(accounts, exportPassword ?? "", {
                random: this.p.random,
                clock: this.p.clock,
                kdf: this.p.kdf,
              }),
            }
          : { filename: `otp-vault-${date}.txt`, content: exportOtpauthText(accounts) };
      await saveSettings(this.p.local, { lastBackupAt: this.p.clock.now() });
      return { ...result, count: accounts.length, skipped: unreadable.length };
    });
  }

  async changePassword(token: string, newPassword: string): Promise<void> {
    assertPassword(newPassword);
    // Queued: a storage move swaps this.vault, and a rewrite against the old area would be lost.
    await this.exclusive(async () => {
      await (await this.spendToken(token)).changePassword(newPassword);
    });
  }

  createRecoveryCode(token: string): Promise<{ recoveryCode: string }> {
    return this.exclusive(async () => ({
      recoveryCode: await (await this.spendToken(token)).createRecoveryCode(),
    }));
  }

  setLockPolicy(token: string, policy: LockPolicy): Promise<void> {
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      const vault = await this.spendToken(token);
      await saveSettings(this.p.local, { lockPolicy: policy });
      await this.keys.store(vault.exportKey(), policy);
      if (await this.relockIfOvertaken(epoch)) return;
      await this.scheduleAutolock(policy);
    });
  }

  setStorageArea(token: string, area: StorageAreaName): Promise<void> {
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      const vault = await this.spendToken(token);
      const { storageArea } = await this.settings();
      if (storageArea === area) return;
      const target = this.area(area);
      try {
        await moveVaultData(this.area(storageArea), target);
      } catch (e) {
        if (isCoreError(e, "vault-exists"))
          throw new ServiceError("already-set-up", "The target storage area already holds a vault");
        throw e;
      }
      // The data has moved, so the setting is saved even if a lock arrived meanwhile.
      await saveSettings(this.p.local, { storageArea: area });
      const moved = await Vault.fromKey(this.deps(target), vault.exportKey());
      if (epoch === this.lockEpoch) this.vault = moved;
    });
  }

  deleteVault(token: string): Promise<void> {
    return this.exclusive(async () => {
      await this.spendToken(token);
      // Bump first so a load that is already in flight cannot reinstate the deleted vault.
      this.lockEpoch++;
      this.loading = null;
      this.vault = null;
      this.onLock();
      // Only the active area: a vault in the other area may belong to another device (user decision).
      const active = this.area((await this.settings()).storageArea);
      const keys = Object.keys(await active.get()).filter(isVaultKey);
      if (keys.length > 0) await active.remove(keys);
      await this.keys.forget();
      await this.p.session.remove([MANUAL_LOCK_KEY]);
      await this.throttle.reset();
      await this.p.alarms.clear(AUTOLOCK_ALARM);
      await saveSettings(this.p.local, DEFAULT_SETTINGS);
    });
  }

  async importPreview(text: string, password?: string): Promise<ImportPreviewView> {
    const epoch = this.lockEpoch;
    const vault = await this.requireVault();
    this.evictExpiredPreviews();
    const outcome = await parseImport(text, password);
    if (outcome.status !== "ok") return outcome;
    const { accounts: existing } = await vault.listAccounts();
    const preview = buildImportPreview(outcome.result.accounts, existing);
    if (epoch !== this.lockEpoch)
      throw new ServiceError("locked", "The vault was locked meanwhile");
    const previewId = this.p.random.uuid();
    // One live preview at most: parsed secrets must not pile up in memory.
    this.previews.clear();
    this.previews.set(previewId, {
      accounts: outcome.result.accounts,
      expiresAt: this.p.clock.now() + PREVIEW_TTL_MS,
    });
    return {
      status: "ok",
      previewId,
      format: outcome.format,
      issues: outcome.result.issues,
      items: preview.map((item, index) => ({
        index,
        issuer: item.account.issuer,
        label: item.account.label,
        type: item.account.type,
        status: item.status,
      })),
    };
  }

  private evictExpiredPreviews(): void {
    const now = this.p.clock.now();
    for (const [id, preview] of this.previews)
      if (preview.expiresAt < now) this.previews.delete(id);
  }

  importCommit(
    previewId: string,
    indexes: number[],
  ): Promise<{ added: number; duplicates: number }> {
    return this.exclusive(() => this.commitPreview(previewId, indexes));
  }

  private async commitPreview(
    previewId: string,
    indexes: number[],
  ): Promise<{ added: number; duplicates: number }> {
    const vault = await this.requireVault();
    this.evictExpiredPreviews();
    const preview = this.previews.get(previewId);
    this.previews.delete(previewId);
    if (!preview || preview.expiresAt < this.p.clock.now()) {
      throw new ServiceError("preview-expired", "The import preview expired; please start again");
    }
    const chosen = [...new Set(indexes)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < preview.accounts.length)
      .map((i) => preview.accounts[i]!);
    const { added, duplicates } = await vault.addAccounts(chosen);
    return { added: added.length, duplicates: duplicates.length };
  }

  async storageUsage(): Promise<StorageUsageView> {
    await this.requireVault();
    const { storageArea } = await this.settings();
    let bytes = 0;
    let indexBytes = 0;
    for (const [key, value] of Object.entries(await this.area(storageArea).get())) {
      if (!isVaultKey(key)) continue;
      const size = itemBytes(key, value);
      bytes += size;
      if (key === "vault:index") indexBytes = size;
    }
    const isSync = storageArea === "sync";
    return {
      area: storageArea,
      bytes,
      indexBytes,
      quotaBytes: isSync ? SYNC_QUOTA_BYTES : null,
      maxItemBytes: isSync ? SYNC_ITEM_QUOTA_BYTES : null,
    };
  }

  applyClockSample(sample: {
    serverDate: string;
    startMs: number;
    endMs: number;
  }): Promise<{ offsetSec: number; applied: number }> {
    return this.exclusive(async () => {
      if (!(await this.settings()).clockCheckEnabled) {
        throw new ServiceError("invalid-request", "The clock check is turned off");
      }
      const offset = computeClockOffset(sample.serverDate, sample.startMs, sample.endMs);
      if (offset === null)
        throw new ServiceError("invalid-request", "The server date could not be read");
      // Offsets this large mean a bad response, not a skewed clock.
      if (Math.abs(offset) > MAX_CLOCK_OFFSET_SEC) {
        throw new ServiceError("invalid-request", "The clock offset is implausibly large");
      }
      const applied = Math.abs(offset) > CLOCK_OFFSET_THRESHOLD_SEC ? offset : 0;
      await saveSettings(this.p.local, { clockOffsetSec: applied });
      return { offsetSec: offset, applied };
    });
  }

  setClockCheckEnabled(enabled: boolean): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(
        this.p.local,
        enabled ? { clockCheckEnabled: true } : { clockCheckEnabled: false, clockOffsetSec: 0 },
      );
    });
  }
}
