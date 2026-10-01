import { webRandom, type ClockPort } from "@otp-vault/core";
import { FakeClock, FAST_KDF, MemoryStorage } from "@otp-vault/core/testing";
import type { AlarmPort, ClipboardPort, Platform } from "../../src/platform/ports";

export class FakeAlarms implements AlarmPort {
  readonly scheduled = new Map<string, number>();

  constructor(private readonly clock: ClockPort) {}

  async create(name: string, delayMinutes: number): Promise<void> {
    this.scheduled.set(name, this.clock.now() + delayMinutes * 60_000);
  }

  async clear(name: string): Promise<void> {
    this.scheduled.delete(name);
  }
}

export class FakeClipboard implements ClipboardPort {
  clears = 0;

  async clear(): Promise<void> {
    this.clears++;
  }
}

export interface TestPlatform extends Platform {
  local: MemoryStorage;
  sync: MemoryStorage;
  session: MemoryStorage;
  alarms: FakeAlarms;
  clipboard: FakeClipboard;
  clock: FakeClock;
}

export function memoryPlatform(): TestPlatform {
  const clock = new FakeClock();
  return {
    local: new MemoryStorage(),
    sync: new MemoryStorage(),
    session: new MemoryStorage(),
    alarms: new FakeAlarms(clock),
    clipboard: new FakeClipboard(),
    clock,
    random: webRandom,
    kdf: FAST_KDF,
  };
}

/** Browser closed and reopened: session is emptied and alarms are cleared; local, sync and the clock stay the same. */
export function restartBrowser(p: TestPlatform): TestPlatform {
  return { ...p, session: new MemoryStorage(), alarms: new FakeAlarms(p.clock) };
}
