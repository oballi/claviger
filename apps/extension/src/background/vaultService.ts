import {
  buildImportPreview,
  buildMigrationUris,
  canonicalJson,
  CLOCK_OFFSET_THRESHOLD_SEC,
  computeClockOffset,
  eligibleKeepers,
  findDuplicateGroups,
  isExactDuplicate,
  pickKeeper,
  exportOtpauthText,
  exportClaviger,
  exportAegis,
  generateCode,
  HEADER_KEY,
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
  type StoragePort,
  type VaultDeps,
} from "@claviger/core";
import type {
  AccountListView,
  DuplicateGroupView,
  AccountView,
  FillOutcome,
  GroupView,
  ImportPreviewItemView,
  ImportPreviewView,
  ServiceState,
  ServiceStatus,
  SnapshotInfo,
  StorageUsageView,
  TrashItemView,
} from "@claviger/ui/views";
import { TRASH_RETENTION_DAYS } from "@claviger/ui/views";
import { MAX_CAPTURE_CHARS } from "@claviger/ui/qr-limits";
import type { Platform, StorageAreaName } from "../platform/ports";
import { ServiceError } from "./errors";
import {
  DAY_MS,
  NotCorruptError,
  recordsStorage,
  SnapshotStore,
  type SnapshotReason,
} from "./snapshots";
import { KeyCache, MANUAL_LOCK_KEY, PERSISTED_KEY } from "./keyCache";
import { SAFE_SECURITY, SecurityStore, type DeviceSecurity } from "./securityStore";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  MAX_CLOCK_OFFSET_SEC,
  saveSettings,
  type BackupReminderDays,
  type ClipboardClearSec,
  type Language,
  type OpenMode,
  type PopupSize,
  type LockPolicy,
  type Settings,
  type Theme,
  type ViewMode,
} from "./settings";
import { backupReminderFor, needsReminderStamp, SNOOZE_DAYS } from "./backupReminder";
import { SNAPSHOT_ATTEMPTS_KEY, Throttle } from "./throttle";

export type {
  AccountListView,
  AccountView,
  FillOutcome,
  GroupView,
  ImportPreviewItemView,
  ImportPreviewView,
  ServiceState,
  ServiceStatus,
  SnapshotInfo,
  StorageUsageView,
};

export const AUTOLOCK_ALARM = "autolock";
export const CLIPBOARD_ALARM = "clipboard-clear";
export const MIN_PASSWORD_LENGTH = 8;
export const TOKEN_TTL_MS = 60_000;
export const PREVIEW_TTL_MS = 10 * 60_000;
export const CAPTURE_TTL_MS = 60_000;
export const MERGE_UNDO_MS = 60_000;
const CAPTURE_PREFIX = "data:image/png;base64,";
/** A slower round trip makes the midpoint too uncertain. */
export const MAX_CLOCK_SAMPLE_MS = 10_000;
export { MAX_CLOCK_OFFSET_SEC };
export const DAILY_CHECK_MS = 60 * 60_000;
export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_ITEM_QUOTA_BYTES = 8_192;
export const MIN_FILL_REMAINING_SEC = 2;
const BADGE_CLEAR_MS = 3_000;

/** storage.sync counts quota as key length plus JSON-encoded value length. */
const PURGE_PENDING_KEY = "snapshotPurgePending";

const itemBytes = (key: string, value: unknown) => key.length + JSON.stringify(value).length;

function unavailable(): ServiceError {
  return new ServiceError("storage-area-unavailable", "No synced storage area on this platform");
}

/** Fill is allowed on https pages, and on plain http only for local development hosts. */
function fillableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

export function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ServiceError(
      "invalid-request",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Last seconds of a period in which the popup also shows (and copies) the next code. */
export const NEXT_CODE_WINDOW_SEC = 7;

/** Single writer for the vault. In-memory state is never trusted: a restarted service worker rebuilds it from KeyCache. */
export class VaultService {
  protected vault: Vault | null = null;
  protected readonly keys: KeyCache;
  protected readonly security: SecurityStore;
  protected readonly throttle: Throttle;
  protected readonly oldPasswordThrottle: Throttle;
  protected readonly snapshots: SnapshotStore;
  // In memory only: a restart repeats the check, and dedupe makes a second copy harmless.
  private lastDailyCheck: number | null = null;
  private reconciling: Promise<void> = Promise.resolve();
  private queue: Promise<unknown> = Promise.resolve();
  // Bumped by lock() so async work that started before it cannot reinstate an unlocked vault.
  private lockEpoch = 0;
  private loading: Promise<Vault | null> | null = null;
  private readonly tokens = new Map<string, number>();
  // Screen captures hold QR secrets: memory only, one at a time, never written to storage.
  private capture: { id: string; dataUrl: string; tabUrl: string; expiresAt: number } | null = null;
  private captureTimer: ReturnType<typeof setTimeout> | undefined;
  // Merge undo offers: memory only, short-lived, dropped on lock.
  private readonly mergeUndos = new Map<string, { ids: string[]; expiresAt: number }>();
  private readonly previews = new Map<
    string,
    {
      accounts: AccountInput[];
      groupNames: (string | undefined)[];
      groups: string[];
      expiresAt: number;
    }
  >();

  constructor(
    protected readonly p: Platform,
    // Applies an open mode in the browser; the real launcher is wired in by the background entry.
    private readonly onOpenModeChange: (mode: OpenMode) => Promise<void> = async () => {},
  ) {
    this.keys = new KeyCache(p);
    this.security = new SecurityStore(p.local);
    this.throttle = new Throttle(p.local, p.clock);
    this.oldPasswordThrottle = new Throttle(p.local, p.clock, SNAPSHOT_ATTEMPTS_KEY);
    this.snapshots = new SnapshotStore(p.local, p.clock, p.random);
  }

  /** Best effort: a failed copy must never block the operation it protects. */
  private async snapshot(reason: SnapshotReason): Promise<void> {
    try {
      await this.snapshots.take(
        this.area(this.effective((await this.settings()).storageArea)),
        reason,
      );
    } catch {
      // Ignored on purpose.
    }
  }

  private dailyDue(): boolean {
    const now = this.p.clock.now();
    const last = this.lastDailyCheck;
    return last === null || now < last || now - last >= DAILY_CHECK_MS;
  }

  private async dailySnapshot(): Promise<void> {
    if (!this.dailyDue()) return;
    const now = this.p.clock.now();
    this.lastDailyCheck = now;
    try {
      await this.snapshots.takeDaily(
        this.area(this.effective((await this.settings()).storageArea)),
      );
    } catch {
      // Ignored on purpose.
    }
  }

  /**
   * Keyslot changes keep the DEK, so copies must not keep keyslots the user just revoked.
   * Never throws: the keyslot change is already written, and the next unlock reconciles.
   */
  private async revokeInSnapshots(vault: Vault): Promise<void> {
    try {
      await this.snapshots.rekey(vault.vaultId, vault.headerSnapshot);
    } catch {
      try {
        await this.snapshots.removeVault(vault.vaultId);
      } catch {
        // Left for reconcileSnapshots on the next unlock.
      }
    }
  }

  /** A Vault captured earlier may hold a header that a later keyslot change replaced; it must not rekey copies back. */
  private async reconcileIfActive(vault: Vault): Promise<void> {
    if (this.vault === vault) await this.reconcileSnapshots(vault);
  }

  /** Repairs a crash or failure between a keyslot write and its revocation in the copies. */
  private async reconcileSnapshots(vault: Vault): Promise<void> {
    try {
      const current = canonicalJson(vault.headerSnapshot);
      const stale = (await this.snapshots.list()).some(
        (s) => s.vaultId === vault.vaultId && canonicalJson(s.records[HEADER_KEY]) !== current,
      );
      if (stale) await this.revokeInSnapshots(vault);
    } catch {
      // Housekeeping only; never fails an unlock.
    }
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const vault = await this.requireVault();
    return (await this.snapshots.list())
      .filter((s) => s.accountCount > 0)
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        reason: s.reason,
        accountCount: s.accountCount,
        sameVault: s.vaultId === vault.vaultId,
      }));
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
    if (name !== "sync") return this.p.local;
    if (!this.p.sync) throw unavailable();
    return this.p.sync;
  }

  /** A persisted "sync" without a sync port (platform change) is served from local, never a crash. */
  private effective(name: StorageAreaName): StorageAreaName {
    return name === "sync" && !this.p.sync ? "local" : name;
  }

  protected deps(storage: StoragePort, opts: { trash?: boolean } = {}): VaultDeps {
    return {
      storage,
      random: this.p.random,
      clock: this.p.clock,
      kdf: this.p.kdf,
      // Opt-in for live vaults only; device-local on purpose, whichever area holds the vault.
      ...(opts.trash ? { trash: this.p.local } : {}),
    };
  }

  /** Adopts a vault in the other area (sync arrival on a new device, or an interrupted area move). */
  private async locateVault(): Promise<{ settings: Settings; exists: boolean }> {
    let settings = await this.settings();
    if (await Vault.exists(this.area(this.effective(settings.storageArea))))
      return { settings, exists: true };
    const other: StorageAreaName =
      this.effective(settings.storageArea) === "local" ? "sync" : "local";
    if (other === "sync" && !this.p.sync) return { settings, exists: false };
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
    const { storageArea } = settings;
    const candidate = await this.keys.loadCandidate();
    if (!candidate || epoch !== this.lockEpoch) return null;
    try {
      const vault = await Vault.fromKey(
        this.deps(this.area(this.effective(storageArea)), { trash: true }),
        candidate.dek,
      );
      if (epoch !== this.lockEpoch) return null;
      // Read only: a cache load is not the place to migrate or re-seal.
      const sealed = await this.security.read(vault);
      if (sealed?.lockPolicy.kind !== "never") {
        // Missing or unreadable seal counts as not never: no key may stay on disk.
        if (epoch === this.lockEpoch && !this.vault) await this.keys.forgetPersisted();
        if (candidate.source === "persisted") return null;
      }
      if (epoch !== this.lockEpoch) return null;
      this.vault = vault;
      await this.clearPurgeMarker();
      // Queued, not awaited: callers may already hold the queue. Repairs a crash after a keyslot write.
      this.reconciling = this.exclusive(async () => {
        await this.reconcileIfActive(vault);
        if (this.vault === vault) await this.purgeLegacySiteMemory(vault);
      });
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

  /** `touch: false` is for background polling, which is not user activity. */
  protected async requireVault(opts: { touch?: boolean } = {}): Promise<Vault> {
    const vault = await this.ensureLoaded();
    if (!vault) throw new ServiceError("locked", "The vault is locked");
    if (opts.touch !== false) await this.touch();
    return vault;
  }

  protected async scheduleAutolock(policy: LockPolicy): Promise<void> {
    if (policy.kind === "timeout") await this.p.alarms.create(AUTOLOCK_ALARM, policy.minutes);
    else await this.p.alarms.clear(AUTOLOCK_ALARM);
  }

  /** In timeout mode every vault interaction restarts the countdown. */
  private async touch(): Promise<void> {
    const vault = this.vault;
    const lockPolicy = vault
      ? ((await this.security.read(vault)) ?? SAFE_SECURITY).lockPolicy
      : SAFE_SECURITY.lockPolicy;
    if (lockPolicy.kind === "timeout")
      await this.p.alarms.create(AUTOLOCK_ALARM, lockPolicy.minutes);
  }

  /** A live vault makes a pending purge meaningless. */
  private async clearPurgeMarker(): Promise<void> {
    try {
      await this.p.local.remove([PURGE_PENDING_KEY]);
    } catch {
      // Housekeeping only.
    }
  }

  /** Returns false (and stays locked) if lock() ran since `epoch`; callers decide whether that is an error. */
  private async activate(vault: Vault, epoch: number, known?: DeviceSecurity): Promise<boolean> {
    if (epoch !== this.lockEpoch) return false;
    // Resolved before the vault goes live: the DEK reaches disk only when the sealed policy says never.
    const { lockPolicy: policy } = known ?? (await this.securityOf(vault));
    if (epoch !== this.lockEpoch) return false;
    this.vault = vault;
    await this.clearPurgeMarker();
    await this.keys.store(vault.exportKey(), policy);
    if (await this.relockIfOvertaken(epoch)) return false;
    await this.throttle.reset();
    await this.scheduleAutolock(policy);
    return true;
  }

  /** Sealed value, or the fail-closed default; keeps the plaintext mirror in step for display. */
  private async securityOf(vault: Vault): Promise<DeviceSecurity> {
    const mirror = (await this.settings()).lockPolicy;
    const { security } = await this.security.resolve(vault, mirror);
    if (JSON.stringify(security.lockPolicy) !== JSON.stringify(mirror)) {
      try {
        await saveSettings(this.p.local, { lockPolicy: security.lockPolicy });
      } catch {
        // Display only; the sealed record decides.
      }
    }
    return security;
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
      // Locked: the plaintext mirror is for display only; no decision reads it.
      lockPolicy: settings.lockPolicy,
      storageArea: this.effective(settings.storageArea),
      clockOffsetSec: settings.clockOffsetSec,
      clockCheckEnabled: settings.clockCheckEnabled,
      revealRequiresPassword: true,
      lastBackupAt: settings.lastBackupAt,
      backupReminderDays: settings.backupReminderDays,
      backupReminder: null as ServiceState["backupReminder"],
      viewMode: settings.viewMode,
      theme: settings.theme,
      language: settings.language,
      openMode: settings.openMode,
      popupSize: settings.popupSize,
      clipboardClearSec: settings.clipboardClearSec,
      recoveryCodeConfirmed: settings.recoveryCodeConfirmed,
      retryAfterMs: await this.throttle.retryAfterMs(),
    };
    const none = { hasRecoveryCode: null, accountCount: null, snapshotOffer: null };
    if (!exists) return { ...base, status: "no-vault", ...none };
    // Queued: a copy taken mid-write could hold a half-changed vault or a revoked keyslot.
    if (this.dailyDue()) await this.exclusive(() => this.dailySnapshot());
    let vault: Vault | null;
    try {
      vault = await this.ensureLoaded();
    } catch (e) {
      if (isCoreError(e, "unsupported-format")) return { ...base, status: "unsupported", ...none };
      if (isCoreError(e, "vault-corrupt")) return { ...base, status: "corrupt", ...none };
      throw e;
    }
    // Safe here: getState never runs inside the queue.
    await this.reconciling;
    // Header-only read: reports unsupported/corrupt, the recovery flag and the count even while locked.
    const info = await Vault.inspect(this.area(this.effective(settings.storageArea)));
    if (info.status === "unsupported" || info.status === "corrupt") {
      return { ...base, status: info.status, ...none };
    }
    if (vault) {
      const sealed = (await this.security.read(vault)) ?? SAFE_SECURITY;
      return {
        ...base,
        backupReminder: await this.backupReminder(info.accountCount),
        lockPolicy: sealed.lockPolicy,
        revealRequiresPassword: sealed.revealRequiresPassword,
        status: "unlocked",
        hasRecoveryCode: vault.hasRecoveryCode(),
        accountCount: info.accountCount,
        snapshotOffer: info.accountCount === 0 ? await this.snapshotOffer() : null,
      };
    }
    if (info.status === "missing") return { ...base, status: "no-vault", ...none };
    return {
      ...base,
      status: "locked",
      hasRecoveryCode: info.hasRecoveryCode,
      accountCount: info.accountCount,
      snapshotOffer: null,
    };
  }

  private async backupReminder(
    accountCount: number | null,
  ): Promise<ServiceState["backupReminder"]> {
    let settings = await this.settings();
    // First account seen without any backup: the clock starts here, once (queued against races).
    // A date from a clock that ran ahead restarts it too.
    if (accountCount && needsReminderStamp(settings, this.p.clock.now())) {
      settings = await this.exclusive(async () => {
        const cur = await this.settings();
        if (!needsReminderStamp(cur, this.p.clock.now())) return cur;
        return saveSettings(this.p.local, { backupReminderSince: this.p.clock.now() });
      });
    }
    return backupReminderFor(settings, accountCount, this.p.clock.now());
  }

  private async snapshotOffer(): Promise<ServiceState["snapshotOffer"]> {
    try {
      const found = (await this.snapshots.list()).find((s) => s.accountCount > 0);
      return found
        ? { id: found.id, createdAt: found.createdAt, accountCount: found.accountCount }
        : null;
    } catch {
      return null;
    }
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
    // Before any cleanup: a rejected setup must not delete leftover snapshots.
    if (opts.storageArea === "sync" && !this.p.sync) throw unavailable();
    const epoch = this.lockEpoch;
    if ((await Vault.exists(this.p.local)) || (this.p.sync && (await Vault.exists(this.p.sync)))) {
      throw new ServiceError("already-set-up", "A vault already exists");
    }
    // Only a deleteVault that did not finish purging leaves copies that belong to no vault;
    // otherwise copies and quarantine of an earlier vault must survive a fresh setup.
    if ((await this.p.local.get([PURGE_PENDING_KEY]))[PURGE_PENDING_KEY]) {
      try {
        await this.snapshots.removeAll();
        await this.p.local.remove([PURGE_PENDING_KEY]);
      } catch {
        // Best effort; the marker stays for the next setup.
      }
    }
    const { vault, recoveryCode } = await Vault.create(
      this.deps(this.area(opts.storageArea), { trash: true }),
      {
        password: opts.password,
        createRecoveryCode: opts.createRecoveryCode,
      },
    );
    await saveSettings(this.p.local, {
      lockPolicy: opts.lockPolicy,
      storageArea: opts.storageArea,
      recoveryCodeConfirmed: recoveryCode === null,
      // A new vault starts its own reminder clock; an older vault's backup does not cover it.
      lastBackupAt: null,
      backupReminderSince: null,
      backupReminderSnoozedUntil: null,
    });
    const security = { lockPolicy: opts.lockPolicy, revealRequiresPassword: true };
    try {
      await this.security.write(vault, security);
    } catch {
      // Shared storage quota: setup must complete; a missing seal fails closed after a restart.
    }
    await this.activate(vault, epoch, security);
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
          this.deps(this.area(this.effective(settings.storageArea)), { trash: true }),
          password,
        );
      } catch (e) {
        if (isCoreError(e, "wrong-password")) return this.failAttempt();
        throw e;
      }
      // A plain unlock persists nothing, so being overtaken by lock() is an error.
      if (!(await this.activate(vault, epoch))) {
        throw new ServiceError("locked", "The vault was locked meanwhile");
      }
      await this.dailySnapshot();
      await this.reconcileIfActive(vault);
      await this.purgeLegacySiteMemory(vault);
      try {
        await vault.purgeTombstones();
      } catch {
        // Housekeeping only; never fails an unlock.
      }
      try {
        await vault.purgeExpiredTrash();
      } catch {
        // Housekeeping only; never fails an unlock.
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
      await this.snapshot("before-recovery");
      let result: { vault: Vault; recoveryCode: string };
      try {
        result = await Vault.unlockWithRecovery(
          this.deps(this.area(this.effective(settings.storageArea)), { trash: true }),
          code,
          newPassword,
        );
      } catch (e) {
        if (isCoreError(e, "invalid-recovery-code")) await this.throttle.recordFailure();
        throw e;
      }
      await this.revokeInSnapshots(result.vault);
      await this.markRecoveryCodeUnconfirmed();
      await this.activate(result.vault, epoch);
      await this.purgeLegacySiteMemory(result.vault);
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
    this.mergeUndos.clear();
    this.dropCapture();
  }

  private dropCapture(): void {
    clearTimeout(this.captureTimer);
    this.captureTimer = undefined;
    this.capture = null;
  }

  async storeCapture(input: { dataUrl: string; tabUrl: string }): Promise<{ id: string }> {
    const epoch = this.lockEpoch;
    await this.requireVault();
    if (epoch !== this.lockEpoch)
      throw new ServiceError("locked", "The vault was locked meanwhile");
    if (!input.dataUrl.startsWith(CAPTURE_PREFIX) || input.dataUrl.length > MAX_CAPTURE_CHARS) {
      throw new ServiceError("invalid-request", "Unsupported capture");
    }
    this.dropCapture();
    const id = this.p.random.uuid();
    this.capture = {
      id,
      dataUrl: input.dataUrl,
      tabUrl: input.tabUrl,
      expiresAt: this.p.clock.now() + CAPTURE_TTL_MS,
    };
    // Frees the memory on time even if nobody takes the capture.
    this.captureTimer = setTimeout(() => {
      if (this.capture?.id === id) this.dropCapture();
    }, CAPTURE_TTL_MS);
    return { id };
  }

  takeCapture(id: string): Promise<{ dataUrl: string; tabUrl: string }> {
    const capture = this.capture;
    if (!capture || capture.id !== id) {
      return Promise.reject(new ServiceError("not-found", "No such capture"));
    }
    // Deleted before returning so a second take can never see it.
    const expired = capture.expiresAt < this.p.clock.now();
    this.dropCapture();
    if (expired) return Promise.reject(new ServiceError("not-found", "The capture expired"));
    return Promise.resolve({ dataUrl: capture.dataUrl, tabUrl: capture.tabUrl });
  }

  async handleAlarm(name: string): Promise<void> {
    if (name === AUTOLOCK_ALARM) await this.lock();
    // Read at fire time: the setting may have been switched off after the copy.
    if (name === CLIPBOARD_ALARM && (await this.settings()).clipboardClearSec > 0) {
      await this.p.clipboard.clear();
    }
  }

  setViewMode(mode: ViewMode): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { viewMode: mode });
    });
  }

  setTheme(theme: Theme): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { theme });
    });
  }

  setLanguage(language: Language): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { language });
    });
  }

  /** Applies the mode in the browser first; a failed apply leaves the stored setting untouched. */
  setOpenMode(mode: OpenMode): Promise<void> {
    return this.exclusive(async () => {
      const previous = (await this.settings()).openMode;
      try {
        await this.onOpenModeChange(mode);
      } catch {
        throw new ServiceError("unsupported-open-mode", "The browser refused this open mode");
      }
      try {
        await saveSettings(this.p.local, { openMode: mode });
      } catch (e) {
        await this.onOpenModeChange(previous).catch(() => {});
        throw e;
      }
    });
  }

  /** For wake-ups: setPopup does not survive a browser restart, so the stored mode is applied again. */
  async reapplyOpenMode(): Promise<void> {
    await this.onOpenModeChange((await this.settings()).openMode);
  }

  setPopupSize(size: PopupSize): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { popupSize: size });
    });
  }

  setClipboardClear(seconds: ClipboardClearSec): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { clipboardClearSec: seconds });
      if (seconds === 0) await this.p.alarms.clear(CLIPBOARD_ALARM);
    });
  }

  // Device-local and not secret: allowed while locked, like the theme.
  setBackupReminder(days: BackupReminderDays): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { backupReminderDays: days });
    });
  }

  dismissBackupReminder(): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, {
        backupReminderSnoozedUntil: this.p.clock.now() + SNOOZE_DAYS * 86_400_000,
      });
    });
  }

  // Only for file exports that leave the vault; on-screen QR codes are not backups.
  private async markBackup(): Promise<void> {
    await saveSettings(this.p.local, {
      lastBackupAt: this.p.clock.now(),
      backupReminderSnoozedUntil: null,
    });
  }

  confirmRecoveryCode(): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { recoveryCodeConfirmed: true });
    });
  }

  async clipboardCopied(): Promise<void> {
    const { clipboardClearSec } = await this.settings();
    if (clipboardClearSec === 0) await this.p.alarms.clear(CLIPBOARD_ALARM);
    else await this.p.alarms.create(CLIPBOARD_ALARM, clipboardClearSec / 60);
  }

  async handleIdleState(
    state: "active" | "idle" | "locked",
    opts: { idleMeansLocked?: boolean } = {},
  ): Promise<void> {
    if (!(state === "locked" || (state === "idle" && opts.idleMeansLocked))) return;
    const SCREEN_LOCK = "browser-close-or-screen-lock";
    // The service worker is usually suspended here, so the vault may not be loaded yet.
    let vault = this.vault;
    if (!vault) {
      try {
        vault = await this.ensureLoaded();
      } catch {
        // Fail closed: a key that cannot be judged must not outlive a screen lock.
        const candidate = await this.keys.loadCandidate().catch(() => ({}));
        if (candidate) await this.lock();
        return;
      }
    }
    // No seal to read (missing, unreadable, tampered) means the policy is unknown: lock.
    const sealed = vault ? await this.security.read(vault) : null;
    // The plaintext mirror may only tighten (trigger a lock), never relax.
    const mirror = (await this.settings()).lockPolicy;
    if (
      (vault && !sealed) ||
      sealed?.lockPolicy.kind === SCREEN_LOCK ||
      mirror.kind === SCREEN_LOCK
    )
      await this.lock();
  }

  async listAccounts(opts: { pageUrl?: string; passive?: boolean } = {}): Promise<AccountListView> {
    const vault = await this.requireVault({ touch: !opts.passive });
    const { clockOffsetSec } = await this.settings();
    const listing = await vault.listAccounts();
    const now = this.p.clock.now();
    const pinned = new Set(listing.pinned);
    const accounts = await Promise.all(
      listing.accounts.map(async (a): Promise<AccountView> => {
        const generated = await generateCode(a, now, clockOffsetSec);
        // The next code leaves the background only inside the window (never for HOTP).
        const period = generated.period;
        const nextCode =
          generated.remaining !== null &&
          period !== null &&
          period >= 2 * NEXT_CODE_WINDOW_SEC &&
          generated.remaining <= NEXT_CODE_WINDOW_SEC
            ? (await generateCode(a, now + period * 1000, clockOffsetSec)).code
            : null;
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
          groupId: a.groupId ?? null,
          code: generated.code,
          remaining: generated.remaining,
          nextCode,
        };
      }),
    );
    const matches = opts.pageUrl
      ? matchAccounts(listing.accounts, opts.pageUrl)
      : { exact: [] as Account[] };
    const pageDomain = opts.pageUrl ? registrableDomain(opts.pageUrl) : null;
    return {
      accounts,
      groups: listing.groups.map((g) => ({ id: g.id, name: g.name })),
      unreadable: listing.unreadable,
      indexDamaged: listing.indexDamaged,
      matches: { exact: matches.exact.map((a) => a.id) },
      pageDomain,
    };
  }

  addAccount(
    source: { uri: string } | { draft: AccountDraft },
    opts: { sourceUrl?: string; allowSameName?: boolean } = {},
  ): Promise<{ id: string; name: string }> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      const parsed =
        "uri" in source ? parseOtpauthUri(source.uri) : normalizeAccountInput(source.draft);
      const domain = opts.sourceUrl ? registrableDomain(opts.sourceUrl) : null;
      const input = domain
        ? normalizeAccountInput({ ...parsed, domains: [...parsed.domains, domain] })
        : parsed;
      if (!opts.allowSameName) {
        const key = (v: string) => v.trim().toLocaleLowerCase("en");
        const { accounts } = await vault.listAccounts();
        // A true duplicate must surface as duplicate-account, not as a name warning.
        const clash =
          !accounts.some((a) => a.secret === input.secret) &&
          accounts.some(
            (a) => key(a.issuer) === key(input.issuer) && key(a.label) === key(input.label),
          );
        if (clash) throw new ServiceError("same-name", "Another account has the same name");
      }
      const account = await vault.addAccount(input);
      return { id: account.id, name: account.issuer || account.label };
    });
  }

  updateAccount(id: string, patch: AccountPatch): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).updateAccount(id, patch);
    });
  }

  createGroup(name: string): Promise<GroupView> {
    return this.exclusive(async () => {
      const group = await (await this.requireVault()).createGroup(name);
      return { id: group.id, name: group.name };
    });
  }

  renameGroup(id: string, name: string): Promise<void> {
    return this.exclusive(async () => (await this.requireVault()).renameGroup(id, name));
  }

  deleteGroup(id: string): Promise<void> {
    return this.exclusive(async () => (await this.requireVault()).deleteGroup(id));
  }

  reorderGroups(ids: string[]): Promise<void> {
    return this.exclusive(async () => (await this.requireVault()).reorderGroups(ids));
  }

  setAccountGroup(id: string, groupId: string | null): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).updateAccount(id, { groupId });
    });
  }

  moveAccount(id: string, groupId: string | null, beforeId: string | null): Promise<void> {
    return this.exclusive(async () => {
      await (await this.requireVault()).moveAccount(id, groupId, beforeId);
    });
  }

  deleteAccount(id: string): Promise<void> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      await this.snapshot("before-delete");
      await vault.deleteAccount(id);
    });
  }

  async listTrash(): Promise<TrashItemView[]> {
    const vault = await this.exclusive(async () => {
      const v = await this.requireVault();
      try {
        await v.purgeExpiredTrash();
      } catch {
        // Housekeeping only.
      }
      return v;
    });
    const now = this.p.clock.now();
    const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
    return (await vault.listTrash()).map((i) => ({
      id: i.id,
      issuer: i.issuer,
      label: i.label,
      deletedAt: i.deletedAt,
      expiresAt: i.expiresAt,
      ageDays: Math.max(0, Math.round((dayStart(now) - dayStart(i.deletedAt)) / DAY_MS)),
      daysLeft: Math.min(
        TRASH_RETENTION_DAYS,
        Math.max(0, Math.ceil((i.expiresAt - now) / DAY_MS)),
      ),
    }));
  }

  restoreTrash(id: string): Promise<{ id: string; name: string }> {
    return this.exclusive(async () => {
      const restored = await (await this.requireVault()).restoreFromTrash(id);
      return { id: restored.id, name: restored.issuer || restored.label };
    });
  }

  listDuplicates(): Promise<{ groups: DuplicateGroupView[] }> {
    return this.exclusive(async () => {
      const { accounts, pinned } = await (await this.requireVault()).listAccounts();
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const pins = new Set(pinned);
      const groups = findDuplicateGroups(accounts).map((g): DuplicateGroupView => {
        if (g.kind !== "exact") return { ...g, keepId: null, ineligible: [] };
        const members = g.ids.map((id) => byId.get(id)!);
        const ok = new Set(eligibleKeepers(members).map((a) => a.id));
        return {
          ...g,
          keepId: pickKeeper(members, pins).id,
          ineligible: g.ids.filter((id) => !ok.has(id)),
        };
      });
      return { groups };
    });
  }

  /** Only exact copies merge. The removed ones land in Recently deleted; the keeper's edits are not undone by undoMerge. */
  mergeAccounts(
    keepId: string,
    removeIds: string[],
  ): Promise<{ removed: string[]; undoId: string }> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      const { accounts, pinned } = await vault.listAccounts();
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const keeper = byId.get(keepId);
      const ids = [...new Set(removeIds)];
      const copies = ids.map((id) => byId.get(id));
      const refuse = () => new ServiceError("invalid-request", "These accounts cannot be merged");
      if (!keeper || ids.length === 0 || ids.length > 50) throw refuse();
      const found: Account[] = [];
      for (const c of copies) {
        if (!c || c.id === keepId || !isExactDuplicate(keeper, c)) throw refuse();
        found.push(c);
      }
      // An HOTP counter must never move backwards.
      if (!eligibleKeepers([keeper, ...found]).some((a) => a.id === keepId)) throw refuse();

      await this.snapshot("before-merge");
      const first = <K extends "issuer" | "label" | "groupId">(k: K) =>
        keeper[k] || found.find((c) => c[k])?.[k];
      const groupId = first("groupId");
      await vault.updateAccount(keepId, {
        domains: [...new Set([...keeper.domains, ...found.flatMap((c) => c.domains)])],
        issuer: first("issuer") ?? "",
        label: first("label") ?? "",
        ...(groupId && groupId !== keeper.groupId ? { groupId } : {}),
      });
      if (!pinned.includes(keepId) && found.some((c) => pinned.includes(c.id)))
        await vault.setPinned(keepId, true);

      const removed: string[] = [];
      for (const copy of found) {
        await vault.deleteAccount(copy.id);
        removed.push(copy.id);
      }
      const undoId = this.p.random.uuid();
      this.pruneMergeUndos();
      this.mergeUndos.set(undoId, {
        ids: removed,
        expiresAt: this.p.clock.now() + MERGE_UNDO_MS,
      });
      return { removed, undoId };
    });
  }

  private pruneMergeUndos(): void {
    const now = this.p.clock.now();
    for (const [key, offer] of this.mergeUndos)
      if (offer.expiresAt < now) this.mergeUndos.delete(key);
  }

  undoMerge(undoId: string): Promise<{ restored: number }> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      this.pruneMergeUndos();
      const offer = this.mergeUndos.get(undoId);
      if (!offer) throw new ServiceError("not-found", "This merge can no longer be undone");
      this.mergeUndos.delete(undoId);
      let restored = 0;
      for (const id of offer.ids) {
        try {
          await vault.restoreFromTrash(id, { allowDuplicate: true });
          restored++;
        } catch (e) {
          // A copy purged or expired meanwhile must not block the others.
          if (!isCoreError(e) || e.code !== "trash-entry-not-found") throw e;
        }
      }
      return { restored };
    });
  }

  purgeTrash(id: string): Promise<void> {
    return this.exclusive(async () => (await this.requireVault()).purgeTrashEntry(id));
  }

  emptyTrash(): Promise<{ removed: number }> {
    return this.exclusive(async () => ({
      removed: await (await this.requireVault()).emptyTrash(),
    }));
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
      const vault = await this.requireVault();
      await this.snapshot("before-rebuild");
      await vault.rebuildIndex();
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

  private checkTokenValid(token: string): void {
    const expiresAt = this.tokens.get(token);
    if (expiresAt === undefined || expiresAt < this.p.clock.now()) {
      throw new ServiceError("invalid-token", "Please confirm your password again");
    }
  }

  restoreSnapshot(
    token: string,
    id: string,
    password?: string,
  ): Promise<{ added: number; skipped: number; unreadable: number; ungrouped: number }> {
    return this.exclusive(async () => {
      const snap = await this.snapshots.get(id);
      if (!snap || snap.accountCount === 0)
        throw new ServiceError("not-found", "The local copy no longer exists");
      const current = await this.requireVault();
      const sameVault = snap.vaultId === current.vaultId;
      if ((await current.listAccounts()).indexDamaged) {
        throw new ServiceError("invalid-request", "Rebuild the index before restoring a copy");
      }
      if ((await Vault.inspect(recordsStorage(snap.records))).status !== "ok") {
        throw new ServiceError("invalid-request", "The local copy cannot be opened");
      }
      let vault: Vault;
      let opened: Vault;
      const deps = this.deps(recordsStorage(snap.records));
      if (sameVault) {
        vault = await this.spendToken(token);
        try {
          opened = await Vault.fromKey(deps, vault.exportKey());
        } catch (e) {
          if (isCoreError(e, "wrong-password"))
            throw new ServiceError("invalid-request", "The local copy cannot be opened");
          throw e;
        }
      } else {
        // The token stays usable until the old password is right, so a typo does not cost a re-auth.
        if (password === undefined) {
          throw new ServiceError(
            "snapshot-password-required",
            "This copy belongs to another vault",
          );
        }
        this.checkTokenValid(token);
        const wait = await this.oldPasswordThrottle.retryAfterMs();
        if (wait > 0)
          throw new ServiceError("throttled", "Too many wrong attempts; try again later", wait);
        try {
          opened = await Vault.unlockWithPassword(deps, password);
        } catch (e) {
          if (isCoreError(e, "wrong-password")) {
            await this.oldPasswordThrottle.recordFailure();
            throw new ServiceError(
              "wrong-password",
              "Wrong password",
              await this.oldPasswordThrottle.retryAfterMs(),
            );
          }
          throw e;
        }
        await this.oldPasswordThrottle.reset();
        vault = await this.spendToken(token);
      }
      const listing = await opened.listAccounts();
      await this.snapshot("before-restore");
      // Same vault: groups are matched by id against the live index and passed by their current
      // name, so a renamed group is reused and a deleted one is never created or resurrected;
      // accounts that are still there are duplicates, so their current group stays untouched.
      const live = sameVault
        ? new Map((await vault.listAccounts()).groups.map((g) => [g.id, g.name]))
        : null;
      const names = live ?? new Map(listing.groups.map((g) => [g.id, g.name]));
      const lostGroup = (a: { groupId?: string | null }) =>
        !!a.groupId && !!live && !live.has(a.groupId);
      const res = await vault.addAccountsWithGroups(
        listing.accounts,
        listing.accounts.map((a) => (a.groupId ? names.get(a.groupId) : undefined)),
        sameVault ? [] : listing.groups.map((g) => g.name),
      );
      const { added, duplicates } = res;
      const dup = new Set<unknown>(duplicates);
      const ungrouped =
        res.ungrouped + listing.accounts.filter((a) => lostGroup(a) && !dup.has(a)).length;
      return {
        added: added.length,
        skipped: duplicates.length,
        unreadable: listing.unreadable.length,
        ungrouped,
      };
    });
  }

  quarantineVault(): Promise<{ moved: number }> {
    return this.exclusive(async () => {
      const { settings } = await this.locateVault();
      const active = this.area(this.effective(settings.storageArea));
      if ((await Vault.inspect(active)).status !== "corrupt") {
        throw new ServiceError("invalid-request", "Only a corrupt vault can be moved aside");
      }
      let moved: number;
      try {
        moved = await this.snapshots.quarantine(active);
      } catch (e) {
        if (e instanceof NotCorruptError)
          throw new ServiceError("invalid-request", "Only a corrupt vault can be moved aside");
        throw e;
      }
      this.lockEpoch++;
      this.loading = null;
      this.vault = null;
      this.onLock();
      await this.keys.forget();
      await this.p.alarms.clear(AUTOLOCK_ALARM);
      await saveSettings(this.p.local, {
        backupReminderSince: null,
        backupReminderSnoozedUntil: null,
      });
      return { moved };
    });
  }

  async revealSecret(token: string | undefined, id: string): Promise<{ uri: string }> {
    // A token that is passed is always spent, even when the setting would let it be omitted.
    let vault: Vault;
    if (token === undefined) {
      vault = await this.requireVault();
      const { revealRequiresPassword } = (await this.security.read(vault)) ?? SAFE_SECURITY;
      if (revealRequiresPassword) await this.spendToken("");
    } else {
      vault = await this.spendToken(token);
    }
    return { uri: toOtpauthUri(await vault.getAccount(id)) };
  }

  setRevealRequiresPassword(token: string, value: boolean): Promise<void> {
    return this.exclusive(async () => {
      const vault = await this.spendToken(token);
      const cur = (await this.security.read(vault)) ?? SAFE_SECURITY;
      await this.security.write(vault, { ...cur, revealRequiresPassword: value });
    });
  }

  async exportVault(
    token: string,
    format: "claviger" | "otpauth" | "aegis" | "aegis-plain",
    exportPassword?: string,
  ): Promise<{ filename: string; content: string; count: number; skipped: number }> {
    if (format === "claviger" || format === "aegis") assertPassword(exportPassword ?? "");
    return this.exclusive(async () => {
      const vault = await this.spendToken(token);
      // An export under the vault password would hand its key material to a file that leaves the vault.
      if (format === "aegis" && (await vault.verifyPassword(exportPassword ?? "")))
        throw new ServiceError("invalid-request", "Use a different password for this export");
      const { accounts, unreadable, groups, pinned } = await vault.listAccounts();
      // The user's calendar day: a UTC date would name an evening export after tomorrow (or yesterday).
      const now = new Date(this.p.clock.now());
      const pad = (n: number) => String(n).padStart(2, "0");
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const result = await (async () => {
        switch (format) {
          case "claviger":
            return {
              filename: `claviger-${date}.claviger`,
              content: await exportClaviger(
                accounts,
                exportPassword ?? "",
                { random: this.p.random, clock: this.p.clock, kdf: this.p.kdf },
                groups,
              ),
            };
          case "aegis":
          case "aegis-plain":
            return {
              filename: `claviger-${date}.aegis.json`,
              content: await exportAegis(
                accounts,
                groups,
                {
                  pinned: new Set(pinned),
                  ...(format === "aegis" ? { password: exportPassword } : {}),
                },
                { random: this.p.random },
              ),
            };
          default:
            return { filename: `claviger-${date}.txt`, content: exportOtpauthText(accounts) };
        }
      })();
      await this.markBackup();
      return { ...result, count: accounts.length, skipped: unreadable.length };
    });
  }

  // Not a backup: lastBackupAt stays untouched, and nothing is persisted.
  exportMigration(
    token: string,
    ids: string[],
  ): Promise<{ uris: string[]; skipped: { name: string; reason: string }[] }> {
    return this.exclusive(async () => {
      const vault = await this.spendToken(token);
      const { accounts } = await vault.listAccounts();
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const selected = [...new Set(ids)].map((id) => {
        const account = byId.get(id);
        if (!account) throw new ServiceError("not-found", "No such account");
        return account;
      });
      const batchId = new DataView(this.p.random.bytes(4).buffer).getUint32(0) & 0x7fffffff || 1;
      const { uris, skipped } = buildMigrationUris(selected, { batchId });
      return { uris, skipped: skipped.map(({ name, reason }) => ({ name, reason })) };
    });
  }

  async changePassword(token: string, newPassword: string): Promise<void> {
    assertPassword(newPassword);
    // Queued: a storage move swaps this.vault, and a rewrite against the old area would be lost.
    await this.exclusive(async () => {
      const vault = await this.spendToken(token);
      await vault.changePassword(newPassword);
      await this.revokeInSnapshots(vault);
    });
  }

  // Best effort: the keyslot change is already committed, so the new code must still be returned.
  private async markRecoveryCodeUnconfirmed(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await saveSettings(this.p.local, { recoveryCodeConfirmed: false });
        return;
      } catch {
        // retried once, then ignored on purpose
      }
    }
  }

  createRecoveryCode(token: string): Promise<{ recoveryCode: string }> {
    return this.exclusive(async () => {
      const vault = await this.spendToken(token);
      const recoveryCode = await vault.createRecoveryCode();
      await this.revokeInSnapshots(vault);
      await this.markRecoveryCodeUnconfirmed();
      return { recoveryCode };
    });
  }

  setLockPolicy(token: string, policy: LockPolicy): Promise<void> {
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      const vault = await this.spendToken(token);
      const cur = (await this.security.read(vault)) ?? SAFE_SECURITY;
      // Seal first and strictly: if it throws, nothing else has changed.
      await this.security.write(vault, { ...cur, lockPolicy: policy });
      await this.keys.store(vault.exportKey(), policy);
      try {
        await saveSettings(this.p.local, { lockPolicy: policy });
      } catch (e) {
        // The mirror is advisory (it may only tighten); the seal and key state are already correct.
        console.error("lockPolicy mirror write failed", e instanceof Error ? e.name : "error");
      }
      if (await this.relockIfOvertaken(epoch)) return;
      await this.scheduleAutolock(policy);
    });
  }

  setStorageArea(token: string, area: StorageAreaName): Promise<void> {
    return this.exclusive(async () => {
      const epoch = this.lockEpoch;
      const storageArea = this.effective((await this.settings()).storageArea);
      // Checked before the token is spent so a refused move leaves the token usable.
      if (storageArea !== area && area === "sync" && !this.p.sync) throw unavailable();
      const vault = await this.spendToken(token);
      if (storageArea === area) return;
      await this.snapshot("before-move");
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
      const moved = await Vault.fromKey(this.deps(target, { trash: true }), vault.exportKey());
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
      const active = this.area(this.effective((await this.settings()).storageArea));
      const keys = Object.keys(await active.get()).filter(isVaultKey);
      if (keys.length > 0) await active.remove(keys);
      // Only once the vault is gone: a marker next to a surviving vault would later wipe quarantine.
      await this.p.local.set({ [PURGE_PENDING_KEY]: true });
      await this.keys.forget();
      await this.security.clear();
      await this.p.session.remove([MANUAL_LOCK_KEY]);
      await Promise.all([this.throttle.reset(), this.oldPasswordThrottle.reset()]);
      await this.p.alarms.clear(AUTOLOCK_ALARM);
      await saveSettings(this.p.local, DEFAULT_SETTINGS);
      // The browser still holds the old panel/window action until it is told the default again.
      await this.onOpenModeChange(DEFAULT_SETTINGS.openMode).catch(() => {});
      // Last, so a failure here can never leave the key cached.
      await this.snapshots.removeAll();
      await this.p.local.remove([PURGE_PENDING_KEY]);
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
      groupNames: outcome.result.groupNames ?? [],
      groups: outcome.result.groups ?? [],
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
        ...(outcome.result.groupNames?.[index] !== undefined
          ? { groupName: outcome.result.groupNames[index] }
          : {}),
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
  ): Promise<{ added: number; duplicates: number; ungrouped: number }> {
    return this.exclusive(() => this.commitPreview(previewId, indexes));
  }

  private async commitPreview(
    previewId: string,
    indexes: number[],
  ): Promise<{ added: number; duplicates: number; ungrouped: number }> {
    const vault = await this.requireVault();
    this.evictExpiredPreviews();
    const preview = this.previews.get(previewId);
    this.previews.delete(previewId);
    if (!preview || preview.expiresAt < this.p.clock.now()) {
      throw new ServiceError("preview-expired", "The import preview expired; please start again");
    }
    await this.snapshot("before-import");
    const picked = [...new Set(indexes)].filter(
      (i) => Number.isInteger(i) && i >= 0 && i < preview.accounts.length,
    );
    const { added, duplicates, ungrouped } = await vault.addAccountsWithGroups(
      picked.map((i) => preview.accounts[i]!),
      picked.map((i) => preview.groupNames[i]),
      preview.groups,
    );
    return { added: added.length, duplicates: duplicates.length, ungrouped };
  }

  async storageUsage(): Promise<StorageUsageView> {
    await this.requireVault();
    const storageArea = this.effective((await this.settings()).storageArea);
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
      // The clock went back during the request; the midpoint would be meaningless.
      if (sample.endMs < sample.startMs) {
        throw new ServiceError("invalid-request", "The measurement ran backwards");
      }
      if (sample.endMs - sample.startMs > MAX_CLOCK_SAMPLE_MS) {
        throw new ServiceError("invalid-request", "The measurement took too long");
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

  private async purgeLegacySiteMemory(vault: Vault): Promise<void> {
    try {
      await vault.clearSiteMemory();
      if (
        (await this.p.local.get(["siteMemoryClearPending"])).siteMemoryClearPending !== undefined
      ) {
        await this.p.local.remove(["siteMemoryClearPending"]);
      }
    } catch {
      // Housekeeping only; never fails an unlock.
    }
  }

  private sleep(ms: number): Promise<void> {
    return this.p.sleep ? this.p.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Types a code into a page. The page URL is always re-read here and never taken from the caller.
   * Only account domains authorise a fill.
   */
  private async fillInto(opts: {
    id: string;
    tabId: number;
    frameId?: number;
    frameUrl?: string;
    explicit?: boolean;
  }): Promise<{ result: FillOutcome; code: string | null; advanced: boolean }> {
    const vault = await this.requireVault();
    const epoch = this.lockEpoch;
    const settings = await this.settings();
    const account = (await vault.listAccounts()).accounts.find((a) => a.id === opts.id);
    if (!account) throw new ServiceError("not-found", "No such account");

    const generate = () => generateCode(account, this.p.clock.now(), settings.clockOffsetSec);
    let generated = await generate();
    if (generated.period !== null) {
      const periodMs = generated.period * 1000;
      const t = this.p.clock.now() + settings.clockOffsetSec * 1000;
      const remainingMs = periodMs - (((t % periodMs) + periodMs) % periodMs);
      if (remainingMs < MIN_FILL_REMAINING_SEC * 1000) {
        await this.sleep(remainingMs + 50);
        generated = await generate();
      }
    }
    if (epoch !== this.lockEpoch) throw new ServiceError("locked", "The vault is locked");

    // Runs twice: once before HOTP advances and once right before injection, since the tab can
    // navigate during the wait. Returns null for a refusal; throws not-linked.
    const check = async (): Promise<{ domain: string } | null> => {
      const tabUrl = await this.p.tabs.url(opts.tabId);
      const targetUrl = opts.frameId ? opts.frameUrl : tabUrl;
      if (!tabUrl || !targetUrl || !fillableUrl(tabUrl) || !fillableUrl(targetUrl)) return null;
      const domain = registrableDomain(targetUrl);
      if (!domain) return null;
      if (opts.frameId && registrableDomain(tabUrl) !== domain) return null;
      if (!account.domains.includes(domain)) {
        throw new ServiceError("not-linked", "Account is not linked to this site");
      }
      return { domain };
    };
    const refused = { result: "refused" as const, code: generated.code, advanced: false };

    if (!(await check())) return refused;
    // HOTP advances only after the first check, so a refused fill never burns a counter value.
    const code = account.type === "hotp" ? await this.advanceHotp(opts.id) : generated.code;
    const advanced = account.type === "hotp";
    // After the advance a not-linked tab is a refusal that still hands the code back, not a throw.
    const target = await check().catch((e: unknown) => {
      if (advanced && e instanceof ServiceError && e.code === "not-linked") return null;
      throw e;
    });
    if (!target) return { result: "refused", code, advanced };
    if (epoch !== this.lockEpoch) throw new ServiceError("locked", "The vault is locked");
    const result = await this.p.tabs.fill(
      opts.tabId,
      opts.frameId,
      code,
      opts.explicit === true,
      target.domain,
    );
    if (result === "filled") return { result: "filled", code: null, advanced };
    return { result: result === "no-field" ? "copied-instead" : "refused", code, advanced };
  }

  private async advanceHotp(id: string): Promise<string> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      const updated = await vault.incrementHotp(id);
      return (await generateCode(updated, this.p.clock.now())).code;
    });
  }

  async flashBadge(text: string): Promise<void> {
    try {
      await this.p.tabs.setBadge(text);
      await this.sleep(BADGE_CLEAR_MS);
    } finally {
      await this.p.tabs.setBadge("").catch(() => undefined);
    }
  }

  /** Synchronous on purpose: listeners use it to open the popup before any await (Firefox user gesture). */
  isUnlockedInMemory(): boolean {
    return this.vault !== null;
  }

  private async tryLoaded(): Promise<Vault | null> {
    try {
      return await this.ensureLoaded();
    } catch {
      return null;
    }
  }

  private async fillFromPage(
    tab: { id: number; url: string },
    frameId: number | undefined,
    frameUrl: string | undefined,
    explicit: boolean,
  ): Promise<void> {
    const subframe = frameId !== undefined && frameId !== 0;
    const url = subframe ? frameUrl : tab.url;
    const vault = await this.requireVault();
    // Only account domains count; names never authorise.
    const exact =
      url && fillableUrl(url)
        ? matchAccounts((await vault.listAccounts()).accounts, url).exact
        : [];
    const only = exact.length === 1 ? exact[0] : undefined;
    if (!only) return this.flashBadge("?");
    try {
      const r = await this.fillInto({
        id: only.id,
        tabId: tab.id,
        frameId,
        frameUrl,
        explicit,
      });
      if (r.result !== "filled") await this.flashBadge("!");
    } catch {
      await this.flashBadge("!");
    }
  }

  /**
   * Popup fill for an account the user picked. Same checks as every other fill (fillInto re-reads the tab).
   * A code leaves only when it would otherwise be lost: the page had no field, or an HOTP counter already
   * advanced and the fill was then refused (returned as copied-instead). Never on success or a refusal before the advance.
   */
  async fillAccount(
    id: string,
    tabId: number,
  ): Promise<{ result: FillOutcome; code: string | null }> {
    const r = await this.fillInto({ id, tabId, explicit: true });
    if (r.result === "copied-instead") return { result: r.result, code: r.code };
    if (r.result === "refused" && r.advanced) return { result: "copied-instead", code: r.code };
    return { result: r.result, code: null };
  }

  /** "locked" tells the trigger to open the popup; Firefox already did so before awaiting. */
  async fillFromCommand(): Promise<"locked" | "done"> {
    if (!(await this.tryLoaded())) return "locked";
    const tab = await this.p.tabs.active();
    if (!tab) await this.flashBadge("?");
    else await this.fillFromPage(tab, undefined, undefined, false);
    return "done";
  }

  async fillFromMenu(
    tab: { id: number; url: string },
    frameId: number | undefined,
    frameUrl: string | undefined,
  ): Promise<"locked" | "done"> {
    if (!(await this.tryLoaded())) return "locked";
    await this.fillFromPage(tab, frameId, frameUrl, true);
    return "done";
  }
}
