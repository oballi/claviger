import { webRandom, type ClockPort } from "@otp-vault/core";
import { FakeClock, FAST_KDF, MemoryStorage } from "@otp-vault/core/testing";
import type { FillResult } from "../../src/inject/fillOtp";
import type { AlarmPort, ClipboardPort, Platform, TabsPort } from "../../src/platform/ports";

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

export class FakeTabs implements TabsPort {
  activeTab: { id: number; url: string } | null = { id: 1, url: "https://example.com/login" };
  /** What tabs.get reports at fill time; null follows activeTab. */
  liveUrl: string | null | undefined = undefined;
  next: FillResult | null = "filled";
  fills: { tabId: number; frameId: number | undefined; code: string; explicit: boolean }[] = [];
  badge = "";
  badges: string[] = [];
  popupOpens = true;
  popupOpened = 0;
  calls: string[] = [];

  async active() {
    this.calls.push("active");
    return this.activeTab;
  }

  async url(tabId: number) {
    this.calls.push("url");
    if (this.liveUrl !== undefined) return this.liveUrl;
    return this.activeTab && this.activeTab.id === tabId ? this.activeTab.url : null;
  }

  async fill(tabId: number, frameId: number | undefined, code: string, explicit: boolean) {
    this.calls.push("fill");
    this.fills.push({ tabId, frameId, code, explicit });
    return this.next;
  }

  async setBadge(text: string) {
    this.badge = text;
    this.badges.push(text);
  }

  async openPopup() {
    this.calls.push("openPopup");
    this.popupOpened++;
    return this.popupOpens;
  }
}

export interface TestPlatform extends Platform {
  local: MemoryStorage;
  sync: MemoryStorage;
  session: MemoryStorage;
  alarms: FakeAlarms;
  clipboard: FakeClipboard;
  tabs: FakeTabs;
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
    tabs: new FakeTabs(),
    clock,
    random: webRandom,
    kdf: FAST_KDF,
    sleep: async (ms) => {
      clock.advance(ms);
    },
  };
}

/** Browser closed and reopened: session is emptied and alarms are cleared; local, sync and the clock stay the same. */
export function restartBrowser(p: TestPlatform): TestPlatform {
  return { ...p, session: new MemoryStorage(), alarms: new FakeAlarms(p.clock) };
}
