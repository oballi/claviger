import { fromBase64, toBase64 } from "@claviger/core";
import type { Platform } from "../platform/ports";
import type { LockPolicy } from "./settings";

export const SESSION_KEY = "lock:sessionKey";
export const PERSISTED_KEY = "lock:persistedKey";
export const MANUAL_LOCK_KEY = "lock:manual";

function decodeKey(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  try {
    const bytes = fromBase64(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Where the DEK of an unlocked vault lives (spec §5.3-5.4):
 * - `session` (memory only, cleared when the browser closes): always while unlocked.
 * - `local` (on disk): only under the "Never" lock policy. NEVER written to `sync`.
 */
export class KeyCache {
  constructor(private readonly p: Platform) {}

  async store(dek: Uint8Array, policy: LockPolicy): Promise<void> {
    const encoded = toBase64(dek);
    await this.p.session.set({ [SESSION_KEY]: encoded });
    await this.p.session.remove([MANUAL_LOCK_KEY]);
    if (policy.kind === "never") await this.p.local.set({ [PERSISTED_KEY]: encoded });
    else await this.p.local.remove([PERSISTED_KEY]);
  }

  async load(policy: LockPolicy): Promise<Uint8Array | null> {
    if (policy.kind !== "never") {
      await this.p.local.remove([PERSISTED_KEY]);
    }
    const session = await this.p.session.get([SESSION_KEY, MANUAL_LOCK_KEY]);
    if (session[MANUAL_LOCK_KEY] === true) return null;
    const fromSession = decodeKey(session[SESSION_KEY]);
    if (fromSession) return fromSession;
    if (policy.kind !== "never") {
      return null;
    }
    return decodeKey((await this.p.local.get([PERSISTED_KEY]))[PERSISTED_KEY]);
  }

  /** Manual lock: the persistent key is not used either until the browser restarts. */
  async lock(): Promise<void> {
    await this.p.session.set({ [MANUAL_LOCK_KEY]: true });
    await this.p.session.remove([SESSION_KEY]);
  }

  async forget(): Promise<void> {
    await this.p.session.remove([SESSION_KEY]);
    await this.p.local.remove([PERSISTED_KEY]);
  }
}
