import type { FillResult } from "../inject/fillOtp";
import type { Argon2Params, ClockPort, RandomPort, StoragePort } from "@otp-vault/core";

export interface AlarmPort {
  create(name: string, delayMinutes: number): Promise<void>;
  clear(name: string): Promise<void>;
}

export interface ClipboardPort {
  /** Overwrites the system clipboard; the browser offers no way to check what is on it. */
  clear(): Promise<void>;
}

export interface TabsPort {
  active(): Promise<{ id: number; url: string } | null>;
  /** Current URL of a tab, read at fill time; null when the browser does not expose it. */
  url(tabId: number): Promise<string | null>;
  /** Runs fillOtp in one frame of the tab; resolves null when the page refuses scripts. */
  fill(
    tabId: number,
    frameId: number | undefined,
    code: string,
    explicit: boolean,
    expectedDomain: string,
  ): Promise<FillResult | null>;
  setBadge(text: string): Promise<void>;
  openPopup(): Promise<boolean>;
}

/** Everything the background logic needs from the browser. Events (alarm, idle) are fed to the service from outside. */
export interface Platform {
  local: StoragePort;
  /** Absent where there is no browser sync area (the desktop app); the vault then lives in `local` only. */
  sync?: StoragePort;
  session: StoragePort;
  alarms: AlarmPort;
  clipboard: ClipboardPort;
  tabs: TabsPort;
  clock: ClockPort;
  random: RandomPort;
  /** Injectable wait so tests can drive the fake clock; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Fast Argon2id for tests only; undefined in production (DEFAULT_ARGON2). */
  kdf?: Argon2Params;
}

export type StorageAreaName = "local" | "sync";
