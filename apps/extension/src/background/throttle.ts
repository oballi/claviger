import type { ClockPort, StoragePort } from "@otp-vault/core";
import { z } from "zod";

export const ATTEMPTS_KEY = "lock:attempts";
export const FREE_ATTEMPTS = 3;
export const MAX_DELAY_MS = 60_000;

const attemptsSchema = z.object({
  failures: z.number().int().min(0),
  lastFailureAt: z.number(),
});

/** spec §5.5: ilk 3 hata serbest; sonra 2, 4, 8 … sn, en fazla 60 sn. */
export function delayAfter(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(2 ** (failures - FREE_ATTEMPTS + 1) * 1000, MAX_DELAY_MS);
}

export class Throttle {
  constructor(
    private readonly storage: StoragePort,
    private readonly clock: ClockPort,
  ) {}

  private async read(): Promise<z.infer<typeof attemptsSchema>> {
    const parsed = attemptsSchema.safeParse((await this.storage.get([ATTEMPTS_KEY]))[ATTEMPTS_KEY]);
    return parsed.success ? parsed.data : { failures: 0, lastFailureAt: 0 };
  }

  async retryAfterMs(): Promise<number> {
    const { failures, lastFailureAt } = await this.read();
    return Math.max(0, delayAfter(failures) - (this.clock.now() - lastFailureAt));
  }

  async recordFailure(): Promise<void> {
    const { failures } = await this.read();
    await this.storage.set({
      [ATTEMPTS_KEY]: { failures: failures + 1, lastFailureAt: this.clock.now() },
    });
  }

  async reset(): Promise<void> {
    await this.storage.remove([ATTEMPTS_KEY]);
  }
}
