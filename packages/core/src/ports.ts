import type { Argon2Params } from "./crypto/kdf";

export interface StoragePort {
  /** Omitting `keys` returns everything; missing keys are absent from the result. */
  get(keys?: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface ClockPort {
  now(): number;
}

export interface RandomPort {
  bytes(length: number): Uint8Array;
  uuid(): string;
}

export interface VaultDeps {
  storage: StoragePort;
  /** Device-local bin for deleted accounts (never synced). Absent: deletes are not recoverable. */
  trash?: StoragePort;
  random: RandomPort;
  clock: ClockPort;
  kdf?: Argon2Params;
}

export const systemClock: ClockPort = { now: () => Date.now() };

export const webRandom: RandomPort = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  uuid: () => crypto.randomUUID(),
};
