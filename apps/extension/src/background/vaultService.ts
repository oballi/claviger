import { isCoreError, Vault, type StoragePort, type VaultDeps } from "@otp-vault/core";
import type { Platform, StorageAreaName } from "../platform/ports";
import { ServiceError } from "./errors";
import { KeyCache } from "./keyCache";
import { loadSettings, saveSettings, type LockPolicy, type Settings } from "./settings";
import { Throttle } from "./throttle";

export const AUTOLOCK_ALARM = "autolock";
export const MIN_PASSWORD_LENGTH = 8;

export type ServiceStatus = "no-vault" | "locked" | "unlocked" | "unsupported" | "corrupt";

export interface ServiceState {
  status: ServiceStatus;
  lockPolicy: LockPolicy;
  storageArea: StorageAreaName;
  hasRecoveryCode: boolean | null;
  retryAfterMs: number;
  clockOffsetSec: number;
  clockCheckEnabled: boolean;
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
    const { storageArea, lockPolicy } = await this.settings();
    const dek = await this.keys.load(lockPolicy);
    if (!dek || epoch !== this.lockEpoch) return null;
    try {
      const vault = await Vault.fromKey(this.deps(this.area(storageArea)), dek);
      if (epoch !== this.lockEpoch) return null;
      this.vault = vault;
      return vault;
    } catch (e) {
      if (isCoreError(e, "wrong-password") || isCoreError(e, "vault-not-found")) {
        // A newer unlock may have stored a good key meanwhile; only forget our own stale one.
        if (epoch === this.lockEpoch) await this.keys.forget();
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

  private async activate(vault: Vault, policy: LockPolicy, epoch: number): Promise<void> {
    if (epoch !== this.lockEpoch)
      throw new ServiceError("locked", "The vault was locked meanwhile");
    this.vault = vault;
    await this.keys.store(vault.exportKey(), policy);
    await this.throttle.reset();
    await this.scheduleAutolock(policy);
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
      retryAfterMs: await this.throttle.retryAfterMs(),
    };
    if (!exists) return { ...base, status: "no-vault", hasRecoveryCode: null };
    let vault: Vault | null;
    try {
      vault = await this.ensureLoaded();
    } catch (e) {
      if (isCoreError(e, "unsupported-format"))
        return { ...base, status: "unsupported", hasRecoveryCode: null };
      if (isCoreError(e, "vault-corrupt"))
        return { ...base, status: "corrupt", hasRecoveryCode: null };
      throw e;
    }
    if (vault) return { ...base, status: "unlocked", hasRecoveryCode: vault.hasRecoveryCode() };
    // Locked: read the header alone so unsupported/corrupt and the recovery flag are still reported.
    const info = await Vault.inspect(this.area(settings.storageArea));
    if (info.status === "unsupported" || info.status === "corrupt") {
      return { ...base, status: info.status, hasRecoveryCode: null };
    }
    if (info.status === "missing") return { ...base, status: "no-vault", hasRecoveryCode: null };
    return { ...base, status: "locked", hasRecoveryCode: info.hasRecoveryCode };
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
      await this.activate(vault, settings.lockPolicy, epoch);
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
  protected onLock(): void {}

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
}
