import "../zodConfig";
import type { ClockPort, StoragePort } from "@claviger/core";
import { z } from "zod";

export const ATTEMPTS_KEY = "lock:attempts";
// Old-password guesses for restoring another vault's copy; unlock success must not reset them.
export const SNAPSHOT_ATTEMPTS_KEY = "lock:snapshotAttempts";
export const FREE_ATTEMPTS = 3;
export const MAX_DELAY_MS = 60_000;

const attemptsSchema = z.object({
  failures: z.number().int().min(0),
  lastFailureAt: z.number(),
});

/** spec §5.5: first 3 failures free; then 2, 4, 8 ... s, at most 60 s. */
export function delayAfter(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(2 ** (failures - FREE_ATTEMPTS + 1) * 1000, MAX_DELAY_MS);
}

export class Throttle {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
    private readonly key: string = ATTEMPTS_KEY,
  ) {}

  private async read(): Promise<z.infer<typeof attemptsSchema>> {
    const parsed = attemptsSchema.safeParse((await this.storage.get([this.key]))[this.key]);
    return parsed.success ? parsed.data : { failures: 0, lastFailureAt: 0 };
  }

  /** A failure stamped in the future (clock moved back) would never count down, so re-stamp it to now. */
  private async readClamped(): Promise<z.infer<typeof attemptsSchema>> {
    const state = await this.read();
    const now = this.clock.now();
    if (state.lastFailureAt <= now) return state;
    const clamped = { failures: state.failures, lastFailureAt: now };
    await this.storage.set({ [this.key]: clamped });
    return clamped;
  }

  async retryAfterMs(): Promise<number> {
    const { failures, lastFailureAt } = await this.readClamped();
    return Math.max(0, delayAfter(failures) - (this.clock.now() - lastFailureAt));
  }

  async recordFailure(): Promise<void> {
    const { failures } = await this.readClamped();
    await this.storage.set({
      [this.key]: { failures: failures + 1, lastFailureAt: this.clock.now() },
    });
  }

  async reset(): Promise<void> {
    await this.storage.remove([this.key]);
  }
}
