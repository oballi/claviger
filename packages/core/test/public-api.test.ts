import { describe, expect, it } from "vitest";
import * as core from "../src/index";

describe("public API", () => {
  it("exports what the extension needs", () => {
    for (const name of [
      "CORE_VERSION",
      "CoreError",
      "isCoreError",
      "webRandom",
      "systemClock",
      "generateCode",
      "totpCounter",
      "secondsRemaining",
      "computeClockOffset",
      "CLOCK_OFFSET_THRESHOLD_SEC",
      "registrableDomain",
      "matchAccounts",
      "normalizeAccountInput",
      "accountFingerprint",
      "parseOtpauthUri",
      "toOtpauthUri",
      "base32Encode",
      "base32Decode",
      "toBase64",
      "fromBase64",
      "Vault",
      "moveVaultData",
      "isVaultKey",
      "HEADER_KEY",
      "TOMBSTONE_TTL_MS",
      "parseRecoveryCode",
      "DEFAULT_ARGON2",
      "parseImport",
      "buildImportPreview",
      "exportOtpvault",
      "exportOtpauthText",
    ]) {
      expect(core, name).toHaveProperty(name);
    }
  });

  it("does not export test doubles from the root", () => {
    for (const name of ["MemoryStorage", "FakeClock", "FAST_KDF"]) {
      expect(core, name).not.toHaveProperty(name);
    }
  });
});
