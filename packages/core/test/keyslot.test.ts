import { describe, expect, it } from "vitest";
import { bytesEqual } from "../src/encoding/bytes";
import { webRandom } from "../src/ports";
import { FAST_KDF } from "../src/testing";
import {
  createPasswordKeyslot,
  createRecoveryKeyslot,
  keyslotSchema,
  openPasswordKeyslot,
  openRecoveryKeyslot,
} from "../src/vault/keyslot";

const dek = webRandom.bytes(32);

describe("password keyslot", () => {
  it("wraps and unwraps the DEK", async () => {
    const slot = await createPasswordKeyslot(dek, "correct horse", "vault-1", webRandom, FAST_KDF);
    expect(slot).toMatchObject({ kind: "password", kdf: { alg: "argon2id", ...FAST_KDF } });
    expect(bytesEqual((await openPasswordKeyslot(slot, "correct horse", "vault-1"))!, dek)).toBe(
      true,
    );
  });

  it("returns null for a wrong password or a different scope", async () => {
    const slot = await createPasswordKeyslot(dek, "correct horse", "vault-1", webRandom, FAST_KDF);
    expect(await openPasswordKeyslot(slot, "wrong", "vault-1")).toBeNull();
    expect(await openPasswordKeyslot(slot, "correct horse", "vault-2")).toBeNull();
  });

  it("does not store the password or DEK in clear text", async () => {
    const slot = await createPasswordKeyslot(dek, "correct horse", "vault-1", webRandom, FAST_KDF);
    const json = JSON.stringify(slot);
    expect(json).not.toContain("correct horse");
    expect(json).not.toContain(Buffer.from(dek).toString("base64"));
  });
});

describe("recovery keyslot", () => {
  it("wraps and unwraps with the recovery secret", async () => {
    const secret = webRandom.bytes(20);
    const slot = await createRecoveryKeyslot(dek, secret, "vault-1", webRandom);
    expect(slot.kind).toBe("recovery");
    expect(bytesEqual((await openRecoveryKeyslot(slot, secret, "vault-1"))!, dek)).toBe(true);
    expect(await openRecoveryKeyslot(slot, webRandom.bytes(20), "vault-1")).toBeNull();
  });
});

describe("keyslotSchema", () => {
  const base = {
    kind: "password",
    kdf: {
      alg: "argon2id",
      salt: "AAAAAAAAAAAAAAAAAAAAAA==",
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    },
    iv: "x",
    ct: "y",
  };

  it("accepts sane parameters", () => {
    expect(keyslotSchema.safeParse(base).success).toBe(true);
  });

  it.each([
    { memoryKiB: 2_000_000 },
    { memoryKiB: 524_288 },
    { memoryKiB: 4 },
    { iterations: 0 },
    { iterations: 11 },
    { parallelism: 64 },
    { memoryKiB: 8, parallelism: 4 },
    { salt: "AAAA" },
    { salt: "not base64!" },
  ])("rejects out-of-bounds KDF parameters %j (DoS / hash-wasm guard)", (patch) => {
    expect(keyslotSchema.safeParse({ ...base, kdf: { ...base.kdf, ...patch } }).success).toBe(
      false,
    );
  });
});
