import { z } from "zod";
import type { StoragePort, Vault } from "@claviger/core";
import { lockPolicySchema, type LockPolicy } from "./settings";

export const SECURITY_KEY = "lock:policy";

const securitySchema = z.object({
  vaultId: z.string().min(1),
  lockPolicy: lockPolicySchema,
  revealRequiresPassword: z.boolean(),
});

export type DeviceSecurity = { lockPolicy: LockPolicy; revealRequiresPassword: boolean };

export const SAFE_SECURITY: DeviceSecurity = {
  lockPolicy: { kind: "browser-close" },
  revealRequiresPassword: true,
};

/** Lock policy and reveal setting sealed under the DEK: storage writers cannot forge or relax them. */
export class SecurityStore {
  constructor(private readonly local: StoragePort) {}

  async read(vault: Vault): Promise<DeviceSecurity | null> {
    const raw = (await this.local.get([SECURITY_KEY]))[SECURITY_KEY];
    const value = await vault.openDeviceRecord(SECURITY_KEY, raw, securitySchema);
    if (!value || value.vaultId !== vault.vaultId) return null;
    return { lockPolicy: value.lockPolicy, revealRequiresPassword: value.revealRequiresPassword };
  }

  /** Throws on storage failure; setters rely on that to stay strict. */
  async write(vault: Vault, value: DeviceSecurity): Promise<void> {
    const sealed = await vault.sealDeviceRecord(SECURITY_KEY, { vaultId: vault.vaultId, ...value });
    await this.local.set({ [SECURITY_KEY]: sealed });
  }

  /**
   * Missing or unreadable seal: fail closed. Only "never" puts the key on disk, so any other
   * plaintext policy is harmless to carry over. A failed seal write (shared quota) must never
   * block an unlock, so the computed value is returned unsealed.
   */
  async resolve(
    vault: Vault,
    legacy: LockPolicy | null,
  ): Promise<{ security: DeviceSecurity; sealedNow: boolean }> {
    const sealed = await this.read(vault);
    if (sealed) return { security: sealed, sealedNow: false };
    const lockPolicy = legacy && legacy.kind !== "never" ? legacy : SAFE_SECURITY.lockPolicy;
    const security = { lockPolicy, revealRequiresPassword: true };
    try {
      await this.write(vault, security);
      return { security, sealedNow: true };
    } catch (e) {
      console.error("lock:policy seal failed", e instanceof Error ? e.name : "error");
      return { security, sealedNow: false };
    }
  }

  clear(): Promise<void> {
    return this.local.remove([SECURITY_KEY]);
  }
}
