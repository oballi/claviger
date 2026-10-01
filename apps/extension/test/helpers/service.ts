import type { LockPolicy } from "../../src/background/settings";
import { VaultService } from "../../src/background/vaultService";
import { memoryPlatform, type TestPlatform } from "./platform";

export const PASSWORD = "correct horse battery";

export async function unlockedService(
  p: TestPlatform = memoryPlatform(),
  lockPolicy: LockPolicy = { kind: "browser-close" },
) {
  const service = new VaultService(p);
  const { recoveryCode } = await service.setup({
    password: PASSWORD,
    createRecoveryCode: true,
    lockPolicy,
    storageArea: "local",
  });
  return { p, service, recoveryCode };
}

export async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return undefined;
}
