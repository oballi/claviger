import { buildMigrationUris } from "@claviger/core";
import qrcode from "qrcode-generator";
import { describe, expect, it } from "vitest";
import { rpcRequestSchema } from "../src/protocol";

describe("migration QR size", () => {
  it("every full batch of long accounts renders within version 20 (97 modules)", () => {
    const accounts = Array.from({ length: 30 }, (_, i) => ({
      type: "totp" as const,
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      issuer: `Issuer ${i}`,
      label: `someone-${i}@example.com`,
      algorithm: "SHA512" as const,
      digits: 8,
      period: 30,
      counter: 0,
      domains: [],
    }));
    const { uris, skipped } = buildMigrationUris(accounts, { batchId: 2 ** 31 - 1 });
    expect(skipped).toEqual([]);
    for (const uri of uris) {
      expect(uri.length).toBeLessThanOrEqual(600);
      const qr = qrcode(0, "M");
      qr.addData(uri);
      qr.make();
      expect(qr.getModuleCount()).toBeLessThanOrEqual(97);
    }
  });
});

describe("exportMigration request", () => {
  const parse = (ids: string[]) =>
    rpcRequestSchema.safeParse({ type: "exportMigration", token: "t", ids }).success;
  it("bounds the id list to 1..10000", () => {
    expect(parse([])).toBe(false);
    expect(parse(["a"])).toBe(true);
    expect(parse(new Array(10_001).fill("a"))).toBe(false);
  });
});
