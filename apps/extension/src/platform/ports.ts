import type { Argon2Params, ClockPort, RandomPort, StoragePort } from "@otp-vault/core";

export interface AlarmPort {
  create(name: string, delayMinutes: number): Promise<void>;
  clear(name: string): Promise<void>;
}

/** Arka plan mantığının tarayıcıdan ihtiyaç duyduğu her şey. Olaylar (alarm, idle) servise dışarıdan iletilir. */
export interface Platform {
  local: StoragePort;
  sync: StoragePort;
  session: StoragePort;
  alarms: AlarmPort;
  clock: ClockPort;
  random: RandomPort;
  /** Yalnızca testlerde hızlı Argon2id için; üretimde tanımsız (DEFAULT_ARGON2). */
  kdf?: Argon2Params;
}

export type StorageAreaName = "local" | "sync";
