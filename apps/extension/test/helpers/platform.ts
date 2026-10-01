import { webRandom, type ClockPort } from "@otp-vault/core";
import { FakeClock, FAST_KDF, MemoryStorage } from "@otp-vault/core/testing";
import type { AlarmPort, Platform } from "../../src/platform/ports";

export class FakeAlarms implements AlarmPort {
  /** alarm adı → tetiklenme zamanı (ms) */
  readonly scheduled = new Map<string, number>();

  constructor(private readonly clock: ClockPort) {}

  async create(name: string, delayMinutes: number): Promise<void> {
    this.scheduled.set(name, this.clock.now() + delayMinutes * 60_000);
  }

  async clear(name: string): Promise<void> {
    this.scheduled.delete(name);
  }
}

export interface TestPlatform extends Platform {
  local: MemoryStorage;
  sync: MemoryStorage;
  session: MemoryStorage;
  alarms: FakeAlarms;
  clock: FakeClock;
}

export function memoryPlatform(): TestPlatform {
  const clock = new FakeClock();
  return {
    local: new MemoryStorage(),
    sync: new MemoryStorage(),
    session: new MemoryStorage(),
    alarms: new FakeAlarms(clock),
    clock,
    random: webRandom,
    kdf: FAST_KDF,
  };
}

/** Tarayıcı kapanıp açıldı: session boşalır ve alarmlar silinir; local, sync ve saat aynı kalır. */
export function restartBrowser(p: TestPlatform): TestPlatform {
  return { ...p, session: new MemoryStorage(), alarms: new FakeAlarms(p.clock) };
}
