import { fromBase64, toBase64 } from "@otp-vault/core";
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
 * Kilidi açık kasanın DEK'i nerede durur (spec §5.3–5.4):
 * - `session` (yalnızca bellekte, tarayıcı kapanınca silinir): kilit açıkken her zaman.
 * - `local` (diskte): yalnızca "Hiçbir zaman" politikasında. ASLA `sync`'e yazılmaz.
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
    const session = await this.p.session.get([SESSION_KEY, MANUAL_LOCK_KEY]);
    const fromSession = decodeKey(session[SESSION_KEY]);
    if (fromSession) return fromSession;
    if (session[MANUAL_LOCK_KEY] === true) return null;
    if (policy.kind !== "never") {
      // Politika "never" değilken diskte kalmış bir kopya (ör. bozuk ayarlar) asla kullanılmaz.
      await this.p.local.remove([PERSISTED_KEY]);
      return null;
    }
    return decodeKey((await this.p.local.get([PERSISTED_KEY]))[PERSISTED_KEY]);
  }

  /** Elle kilit: tarayıcı yeniden açılana dek kalıcı anahtar da kullanılmaz. */
  async lock(): Promise<void> {
    await this.p.session.remove([SESSION_KEY]);
    await this.p.session.set({ [MANUAL_LOCK_KEY]: true });
  }

  async forget(): Promise<void> {
    await this.p.session.remove([SESSION_KEY]);
    await this.p.local.remove([PERSISTED_KEY]);
  }
}
