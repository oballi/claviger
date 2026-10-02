import { describe, expect, it } from "vitest";
import type { AccountInput } from "../src/account/account";
import { buildMigrationUris } from "../src/exporters/googleMigration";
import { fromBase64 } from "../src/encoding/base64";
import { readFields } from "../src/encoding/protobuf";
import { parseGoogleMigrationUri } from "../src/importers/googleMigration";

const acc = (over: Partial<AccountInput> = {}): AccountInput => ({
  type: "totp",
  secret: "JBSWY3DPEHPK3PXP",
  issuer: "Example",
  label: "alice@example.com",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  counter: 0,
  domains: [],
  ...over,
});

function readBack(uris: string[]) {
  return uris.flatMap((u) => parseGoogleMigrationUri(u).accounts);
}

describe("buildMigrationUris", () => {
  it("round-trips through the importer", () => {
    const input = [
      acc(),
      acc({ type: "hotp", counter: 7, issuer: "", label: "hotp-user" }),
      acc({ algorithm: "SHA256", digits: 8, secret: "GEZDGNBVGY3TQOJQ", label: "büğra" }),
    ];
    const { uris, skipped } = buildMigrationUris(input, { batchId: 42 });
    expect(skipped).toEqual([]);
    expect(readBack(uris)).toEqual(input);
  });

  it("lists what the format cannot express, losing none", () => {
    const input = [
      acc({ digits: 7, label: "seven" }),
      acc({ type: "steam", label: "steam" }),
      acc({ period: 60, label: "slow" }),
      acc({ label: "ok" }),
    ];
    const { uris, skipped } = buildMigrationUris(input, { batchId: 1 });
    expect(skipped.map((s) => [s.name, s.reason])).toEqual([
      ["Example: seven", "digits-unsupported"],
      ["Example: steam", "type-unsupported"],
      ["Example: slow", "period-unsupported"],
    ]);
    expect(readBack(uris)).toHaveLength(1);
    expect(readBack(uris).length + skipped.length).toBe(input.length);
  });

  it("splits into batches with consistent batch fields and keeps order", () => {
    const input = Array.from({ length: 25 }, (_, i) => acc({ label: `user-${i}` }));
    const { uris, skipped } = buildMigrationUris(input, { batchId: 12345 });
    expect(skipped).toEqual([]);
    expect(uris.length).toBeGreaterThan(1);
    uris.forEach((u, i) => {
      expect(u.length).toBeLessThanOrEqual(600);
      const r = parseGoogleMigrationUri(u);
      expect(r.accounts.length).toBeLessThanOrEqual(8);
      expect(r.batch).toEqual({ size: uris.length, index: i, id: 12345 });
    });
    expect(readBack(uris).map((a) => a.label)).toEqual(input.map((a) => a.label));
  });

  it("skips a single account that cannot fit one QR", () => {
    const { uris, skipped } = buildMigrationUris([acc({ label: "x".repeat(2000) }), acc()]);
    expect(skipped.map((s) => s.reason)).toEqual(["too-long"]);
    expect(readBack(uris)).toHaveLength(1);
  });

  it("returns nothing for no accounts", () => {
    expect(buildMigrationUris([])).toEqual({ uris: [], skipped: [] });
  });

  it("writes name as the label only and issuer as its own field", () => {
    const { uris } = buildMigrationUris([acc()], { batchId: 1 });
    const data = decodeURIComponent(uris[0]!.split("data=")[1]!);
    const params = readFields(fromBase64(data)).find((f) => f.field === 1)!;
    const inner = readFields(params.value as Uint8Array);
    expect(new TextDecoder().decode(inner.find((f) => f.field === 2)!.value as Uint8Array)).toBe(
      "alice@example.com",
    );
    expect(new TextDecoder().decode(inner.find((f) => f.field === 3)!.value as Uint8Array)).toBe(
      "Example",
    );
  });

  it("defaults to a positive 31-bit batch id", () => {
    const { uris } = buildMigrationUris([acc()]);
    const id = parseGoogleMigrationUri(uris[0]!).batch!.id;
    expect(id).toBeGreaterThan(0);
  });
});
