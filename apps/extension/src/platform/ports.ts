import type { Argon2Params, ClockPort, RandomPort, StoragePort } from "@otp-vault/core";

export interface AlarmPort {
  create(name: string, delayMinutes: number): Promise<void>;
  clear(name: string): Promise<void>;
}

export interface ClipboardPort {
  /** Overwrites the system clipboard; the browser offers no way to check what is on it. */
  clear(): Promise<void>;
}

/** Everything the background logic needs from the browser. Events (alarm, idle) are fed to the service from outside. */
export interface Platform {
  local: StoragePort;
  sync: StoragePort;
  session: StoragePort;
  alarms: AlarmPort;
  clipboard: ClipboardPort;
  clock: ClockPort;
  random: RandomPort;
  /** Fast Argon2id for tests only; undefined in production (DEFAULT_ARGON2). */
  kdf?: Argon2Params;
}

export type StorageAreaName = "local" | "sync";
