import type { Argon2Params } from "../crypto/kdf";
import type { ClockPort, StoragePort } from "../ports";

/** Fast Argon2id parameters for tests. NEVER use in production. */
export const FAST_KDF: Argon2Params = { memoryKiB: 1024, iterations: 1, parallelism: 1 };

export class MemoryStorage implements StoragePort {
  readonly data = new Map<string, unknown>();
  /** When set, the next set() throws this error and writes nothing. */
  failNextSet: Error | null = null;

  async get(keys?: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      if (!keys || keys.includes(key)) out[key] = structuredClone(value);
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failNextSet) {
      const error = this.failNextSet;
      this.failNextSet = null;
      throw error;
    }
    for (const [key, value] of Object.entries(items)) this.data.set(key, structuredClone(value));
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }
}

export class FakeClock implements ClockPort {
  constructor(public ms = 1_700_000_000_000) {}

  now(): number {
    return this.ms;
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}
