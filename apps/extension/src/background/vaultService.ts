import {
  buildImportPreview,
  CLOCK_OFFSET_THRESHOLD_SEC,
  computeClockOffset,
  exportOtpauthText,
  exportClaviger,
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
import type { Platform, StorageAreaName } from "../platform/ports";
import { ServiceError } from "./errors";
import {
  canonicalJson,
  DAY_MS,
  NotCorruptError,
  recordsStorage,
  SnapshotStore,
  type SnapshotReason,
} from "./snapshots";
import { KeyCache, MANUAL_LOCK_KEY, PERSISTED_KEY } from "./keyCache";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type ClipboardClearSec,
  type LockPolicy,
  type Settings,
  type Theme,
  type ViewMode,
} from "./settings";
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
export const CAPTURE_MAX_CHARS = 32_000_000;
const CAPTURE_PREFIX = "data:image/png;base64,";
/** A slower round trip makes the midpoint too uncertain. */
export const MAX_CLOCK_SAMPLE_MS = 10_000;
export const MAX_CLOCK_OFFSET_SEC = 12 * 3600;
export const DAILY_CHECK_MS = 60 * 60_000;
export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_ITEM_QUOTA_BYTES = 8_192;
export const MIN_FILL_REMAINING_SEC = 2;
const BADGE_CLEAR_MS = 3_000;
const MEMORY_CLEAR_PENDING_KEY = "siteMemoryClearPending";

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

/** Single writer for the vault. In-memory state is never trusted: a restarted service worker rebuilds it from KeyCache. */
export class VaultService {
  protected vault: Vault | null = null;
  protected readonly keys: KeyCache;
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
  private readonly previews = new Map<
    string,
    {
      accounts: AccountInput[];
      groupNames: (string | undefined)[];
      groups: string[];
      expiresAt: number;
    }
  >();

  constructor(protected readonly p: Platform) {
    this.keys = new KeyCache(p);
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
    return (await this.snapshots.list()).map((s) => ({
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
    const { storageArea, lockPolicy } = settings;
    const dek = await this.keys.load(lockPolicy);
    if (!dek || epoch !== this.lockEpoch) return null;
    try {
      const vault = await Vault.fromKey(
        this.deps(this.area(this.effective(storageArea)), { trash: true }),
        dek,
      );
      if (epoch !== this.lockEpoch) return null;
      this.vault = vault;
      await this.clearPurgeMarker();
      await this.applyPendingMemoryClear(vault);
      // Queued, not awaited: callers may already hold the queue. Repairs a crash after a keyslot write.
      this.reconciling = this.exclusive(() => this.reconcileIfActive(vault));
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

  /** A live vault makes a pending purge meaningless. */
  private async clearPurgeMarker(): Promise<void> {
    try {
      await this.p.local.remove([PURGE_PENDING_KEY]);
    } catch {
      // Housekeeping only.
    }
  }

  /** Returns false (and stays locked) if lock() ran since `epoch`; callers decide whether that is an error. */
  private async activate(vault: Vault, policy: LockPolicy, epoch: number): Promise<boolean> {
    if (epoch !== this.lockEpoch) return false;
    this.vault = vault;
    await this.clearPurgeMarker();
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
      storageArea: this.effective(settings.storageArea),
      clockOffsetSec: settings.clockOffsetSec,
      clockCheckEnabled: settings.clockCheckEnabled,
      revealRequiresPassword: settings.revealRequiresPassword,
      lastBackupAt: settings.lastBackupAt,
      viewMode: settings.viewMode,
      theme: settings.theme,
      clipboardClearSec: settings.clipboardClearSec,
      recoveryCodeConfirmed: settings.recoveryCodeConfirmed,
      fillOnlyLinked: settings.fillOnlyLinked,
      siteMemory: settings.siteMemory,
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
      return {
        ...base,
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
          this.deps(this.area(this.effective(settings.storageArea)), { trash: true }),
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
      await this.dailySnapshot();
      await this.reconcileIfActive(vault);
      await this.applyPendingMemoryClear(vault);
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
      await this.activate(result.vault, settings.lockPolicy, epoch);
      await this.applyPendingMemoryClear(result.vault);
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
    if (!input.dataUrl.startsWith(CAPTURE_PREFIX) || input.dataUrl.length > CAPTURE_MAX_CHARS) {
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

  setClipboardClear(seconds: ClipboardClearSec): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { clipboardClearSec: seconds });
      if (seconds === 0) await this.p.alarms.clear(CLIPBOARD_ALARM);
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
          groupId: a.groupId ?? null,
          code: generated.code,
          remaining: generated.remaining,
        };
      }),
    );
    const matches = opts.pageUrl
      ? matchAccounts(listing.accounts, opts.pageUrl)
      : { exact: [] as Account[], suggested: [] as Account[] };
    const pageDomain = opts.pageUrl ? registrableDomain(opts.pageUrl) : null;
    const remembered: string[] = [];
    if (pageDomain && (await this.settings()).siteMemory) {
      try {
        const id = (await vault.getSiteMemory(new Set(listing.accounts.map((a) => a.id))))[
          pageDomain
        ];
        if (id && !matches.exact.some((a) => a.id === id)) remembered.push(id);
      } catch {
        // Ordering hint only.
      }
    }
    return {
      accounts,
      groups: listing.groups.map((g) => ({ id: g.id, name: g.name })),
      unreadable: listing.unreadable,
      indexDamaged: listing.indexDamaged,
      matches: {
        exact: matches.exact.map((a) => a.id),
        suggested: matches.suggested.map((a) => a.id),
        remembered,
      },
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
      if (!snap) throw new ServiceError("not-found", "The local copy no longer exists");
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
      return { moved };
    });
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
    format: "claviger" | "otpauth",
    exportPassword?: string,
  ): Promise<{ filename: string; content: string; count: number; skipped: number }> {
    if (format === "claviger") assertPassword(exportPassword ?? "");
    return this.exclusive(async () => {
      const vault = await this.spendToken(token);
      const { accounts, unreadable, groups } = await vault.listAccounts();
      // The user's calendar day: a UTC date would name an evening export after tomorrow (or yesterday).
      const now = new Date(this.p.clock.now());
      const pad = (n: number) => String(n).padStart(2, "0");
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const result =
        format === "claviger"
          ? {
              filename: `claviger-${date}.claviger`,
              content: await exportClaviger(
                accounts,
                exportPassword ?? "",
                { random: this.p.random, clock: this.p.clock, kdf: this.p.kdf },
                groups,
              ),
            }
          : { filename: `claviger-${date}.txt`, content: exportOtpauthText(accounts) };
      await saveSettings(this.p.local, { lastBackupAt: this.p.clock.now() });
      return { ...result, count: accounts.length, skipped: unreadable.length };
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
      await saveSettings(this.p.local, { lockPolicy: policy });
      await this.keys.store(vault.exportKey(), policy);
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
      await this.p.session.remove([MANUAL_LOCK_KEY]);
      await Promise.all([this.throttle.reset(), this.oldPasswordThrottle.reset()]);
      await this.p.alarms.clear(AUTOLOCK_ALARM);
      await saveSettings(this.p.local, DEFAULT_SETTINGS);
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

  setFillOnlyLinked(value: boolean): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { fillOnlyLinked: value });
    });
  }

  setSiteMemory(value: boolean): Promise<void> {
    return this.exclusive(async () => {
      await saveSettings(this.p.local, { siteMemory: value });
      if (value) return;
      let vault: Vault | null = null;
      try {
        vault = await this.ensureLoaded();
      } catch {
        // Unreadable vault: treated like locked.
      }
      // While locked the record cannot be touched; the next unlock removes it.
      if (vault) await vault.clearSiteMemory();
      else await this.p.local.set({ [MEMORY_CLEAR_PENDING_KEY]: true });
    });
  }

  private async applyPendingMemoryClear(vault: Vault): Promise<void> {
    try {
      if (!(await this.p.local.get([MEMORY_CLEAR_PENDING_KEY]))[MEMORY_CLEAR_PENDING_KEY]) return;
      await vault.clearSiteMemory();
      await this.p.local.remove([MEMORY_CLEAR_PENDING_KEY]);
    } catch {
      // Retried on the next unlock; never fails an unlock.
    }
  }

  private sleep(ms: number): Promise<void> {
    return this.p.sleep ? this.p.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Types a code into a page. The page URL is always re-read here and never taken from the caller;
   * site memory never authorises a fill.
   */
  private async fillInto(opts: {
    id: string;
    tabId: number;
    frameId?: number;
    frameUrl?: string;
    confirmedDomain?: string;
    explicit?: boolean;
    requireLinked?: boolean;
  }): Promise<{ result: FillOutcome; code: string | null }> {
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
    const check = async (): Promise<{ domain: string; linked: boolean } | null> => {
      const tabUrl = await this.p.tabs.url(opts.tabId);
      const targetUrl = opts.frameId ? opts.frameUrl : tabUrl;
      if (!tabUrl || !targetUrl || !fillableUrl(tabUrl) || !fillableUrl(targetUrl)) return null;
      const domain = registrableDomain(targetUrl);
      if (!domain) return null;
      if (opts.frameId && registrableDomain(tabUrl) !== domain) return null;
      const linked = account.domains.includes(domain);
      // Confirmation counts only for the domain the user was shown, and never when fillOnlyLinked is on.
      const confirmed = opts.confirmedDomain === domain;
      if (!linked && (opts.requireLinked || settings.fillOnlyLinked || !confirmed)) {
        throw new ServiceError("not-linked", "Account is not linked to this site");
      }
      return { domain, linked };
    };
    const refused = { result: "refused" as const, code: generated.code };

    if (!(await check())) return refused;
    // HOTP advances only after the first check, so a refused fill never burns a counter value.
    const code = account.type === "hotp" ? await this.advanceHotp(opts.id) : generated.code;
    const target = await check();
    if (!target) return { result: "refused", code };
    const result = await this.p.tabs.fill(
      opts.tabId,
      opts.frameId,
      code,
      opts.explicit === true,
      target.domain,
    );
    if (result === "filled") {
      // Re-read: the setting may have been switched off during the wait. Linked domains need no hint.
      if (!target.linked && (await this.settings()).siteMemory) {
        await this.rememberBestEffort(vault, target.domain, opts.id);
      }
      return { result: "filled", code: null };
    }
    return { result: result === "no-field" ? "copied-instead" : "refused", code };
  }

  private async advanceHotp(id: string): Promise<string> {
    return this.exclusive(async () => {
      const vault = await this.requireVault();
      const updated = await vault.incrementHotp(id);
      return (await generateCode(updated, this.p.clock.now())).code;
    });
  }

  /** Convenience only: a failure here (e.g. sync quota) must not turn a successful fill into an error. */
  private async rememberBestEffort(vault: Vault, domain: string, id: string): Promise<void> {
    try {
      await vault.rememberSite(domain, id);
    } catch {
      // Ignored on purpose.
    }
  }

  async fillCode(opts: {
    id: string;
    tabId: number;
    confirmedDomain?: string;
  }): Promise<{ result: FillOutcome; code: string | null }> {
    // Only the tab the user is looking at; a stale or forged id must not reach another tab.
    if ((await this.p.tabs.active())?.id !== opts.tabId) {
      throw new ServiceError("invalid-request", "Not the active tab");
    }
    // Top frame only: the popup has no frame URL to check, so it never targets subframes.
    return this.fillInto({
      id: opts.id,
      tabId: opts.tabId,
      confirmedDomain: opts.confirmedDomain,
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
    // Only account domains count; site memory and issuer-name suggestions never authorise.
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
        requireLinked: true,
      });
      if (r.result !== "filled") await this.flashBadge("!");
    } catch {
      await this.flashBadge("!");
    }
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
