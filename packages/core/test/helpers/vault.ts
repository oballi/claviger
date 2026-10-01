import { webRandom, type VaultDeps } from "../../src/ports";
import { FakeClock, FAST_KDF, MemoryStorage } from "../../src/testing";

export function makeDeps(): VaultDeps & { storage: MemoryStorage; clock: FakeClock } {
  return { storage: new MemoryStorage(), random: webRandom, clock: new FakeClock(), kdf: FAST_KDF };
}
