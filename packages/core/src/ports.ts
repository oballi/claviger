import type { Argon2Params } from "./crypto/kdf";

export interface StoragePort {
  /** `keys` verilmezse tüm öğeleri döner. Olmayan anahtarlar sonuçta yer almaz. */
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
  random: RandomPort;
  clock: ClockPort;
  /** Yeni parola keyslot'ları için Argon2id parametreleri; verilmezse DEFAULT_ARGON2. */
  kdf?: Argon2Params;
}

export const systemClock: ClockPort = { now: () => Date.now() };

export const webRandom: RandomPort = {
  bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  uuid: () => crypto.randomUUID(),
};
