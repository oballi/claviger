import { createDecipheriv, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AccountInput } from "../src/account/account";
import { exportAegis } from "../src/exporters/aegis";
import { parseAegis } from "../src/importers/aegis";
import { parseImport } from "../src/importers";
import { webRandom } from "../src/ports";
import { asyncCodeOf } from "./helpers/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deps = { random: webRandom };

const acc = (over: Partial<AccountInput & { id: string; groupId?: string }> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555",
  type: "totp" as const,
  secret: "JBSWY3DPEHPK3PXP",
  issuer: "Example",
  label: "alice@example.com",
  algorithm: "SHA1" as const,
  digits: 6,
  period: 30,
  counter: 0,
  domains: [],
  ...over,
});

const strip = ({ id: _id, groupId: _g, ...rest }: ReturnType<typeof acc>): AccountInput => rest;

interface EncryptedFile {
  header: {
    slots: {
      salt: string;
      n: number;
      r: number;
      p: number;
      key: string;
      key_params: { nonce: string; tag: string };
    }[];
    params: { nonce: string; tag: string };
  };
  db: string;
}

function independentDecrypt(file: EncryptedFile, password: string) {
  const slot = file.header.slots[0];
  const kek = scryptSync(password, Buffer.from(slot.salt, "hex"), 32, {
    N: slot.n,
    r: slot.r,
    p: slot.p,
    maxmem: 128 * 1024 * 1024,
  });
  const mk = createDecipheriv("aes-256-gcm", kek, Buffer.from(slot.key_params.nonce, "hex"));
  mk.setAuthTag(Buffer.from(slot.key_params.tag, "hex"));
  const master = Buffer.concat([mk.update(Buffer.from(slot.key, "hex")), mk.final()]);
  const db = createDecipheriv("aes-256-gcm", master, Buffer.from(file.header.params.nonce, "hex"));
  db.setAuthTag(Buffer.from(file.header.params.tag, "hex"));
  return JSON.parse(
    Buffer.concat([db.update(Buffer.from(file.db, "base64")), db.final()]).toString("utf8"),
  );
}

describe("exportAegis", () => {
  it("never reuses a nonce between the slot and the database", async () => {
    const json = JSON.parse(await exportAegis([acc()], [], { password: "pw" }, deps));
    expect(json.header.slots[0].key_params.nonce).not.toBe(json.header.params.nonce);
  });

  it("plain output reads back through parseAegis", async () => {
    const input = [
      acc(),
      acc({ id: "a", type: "hotp", counter: 7, issuer: "", label: "hotp-user" }),
      acc({ id: "b", type: "steam", digits: 5, label: "steam" }),
      acc({ id: "c", algorithm: "SHA512", digits: 8, period: 60, label: "strong" }),
    ];
    const json = JSON.parse(await exportAegis(input, [], {}, deps));
    expect(json.header).toEqual({ slots: null, params: null });
    const back = await parseAegis(json);
    expect(back.issues).toEqual([]);
    expect(back.accounts).toEqual(input.map(strip));
  });

  it("maps groups, favorites and writes the full entry shape with valid uuids", async () => {
    const input = [
      acc({ groupId: "g1" }),
      acc({ id: "not-a-uuid", label: "b" }),
      acc({ id: "99999999-2222-4333-8444-555555555555", type: "hotp", counter: 3, label: "c" }),
    ];
    const groups = [{ id: "g1", name: "Work" }];
    const json = JSON.parse(
      await exportAegis(input, groups, { pinned: new Set([input[0]!.id]) }, deps),
    );
    expect(json.db.version).toBe(3);
    expect(json.db.groups).toHaveLength(1);
    expect(json.db.groups[0].name).toBe("Work");
    const [e0, e1, e2] = json.db.entries;
    expect(e0.groups).toEqual([json.db.groups[0].uuid]);
    expect(e0.favorite).toBe(true);
    expect(e1.groups).toEqual([]);
    expect(e1.favorite).toBe(false);
    expect(e0).toMatchObject({
      note: "",
      icon: null,
      name: "alice@example.com",
      issuer: "Example",
    });
    expect(e0.info).toMatchObject({
      secret: "JBSWY3DPEHPK3PXP",
      algo: "SHA1",
      digits: 6,
      period: 30,
    });
    expect(e0.info.counter).toBeUndefined();
    expect(e2.info.counter).toBe(3);
    expect(e2.info.period).toBeUndefined();
    expect(e0.uuid).toBe(input[0]!.id);
    expect(e1.uuid).not.toBe("not-a-uuid");
    for (const uuid of [
      json.db.groups[0].uuid,
      ...json.db.entries.map((e: { uuid: string }) => e.uuid),
    ])
      expect(uuid).toMatch(UUID);
  });

  it("encrypted output opens with parseImport and with independent node:crypto", async () => {
    const input = [acc(), acc({ id: "x", label: "second" })];
    const text = await exportAegis(input, [], { password: "correct horse" }, deps);
    const file = JSON.parse(text);
    expect(file.header.slots[0]).toMatchObject({ type: 1, n: 32768, r: 8, p: 1, repaired: true });
    expect(text).not.toContain("JBSWY3DPEHPK3PXP");

    const plain = independentDecrypt(file, "correct horse");
    expect(plain.version).toBe(3);
    expect(plain.entries).toHaveLength(2);

    const out = await parseImport(text, "correct horse");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unexpected");
    expect(out.format).toBe("aegis");
    expect(out.result.accounts).toEqual(input.map(strip));
  }, 30_000);

  it("rejects a wrong password and never reuses salt or nonce", async () => {
    const a = await exportAegis([acc()], [], { password: "pw-one-pw" }, deps);
    const b = await exportAegis([acc()], [], { password: "pw-one-pw" }, deps);
    expect(await asyncCodeOf(parseAegis(JSON.parse(a), "wrong-pw"))).toBe("wrong-password");
    const [fa, fb] = [JSON.parse(a), JSON.parse(b)];
    expect(fa.header.slots[0].salt).not.toBe(fb.header.slots[0].salt);
    expect(fa.header.params.nonce).not.toBe(fb.header.params.nonce);
    expect(fa.header.slots[0].key).not.toBe(fb.header.slots[0].key);
  }, 30_000);

  it("an empty account list is a valid file", async () => {
    const plain = await parseAegis(JSON.parse(await exportAegis([], [], {}, deps)));
    expect(plain.accounts).toEqual([]);
    const enc = await parseAegis(
      JSON.parse(await exportAegis([], [], { password: "pw-one-pw" }, deps)),
      "pw-one-pw",
    );
    expect(enc.accounts).toEqual([]);
  }, 30_000);

  it("keeps non-ASCII text intact", async () => {
    const input = [acc({ issuer: "Ürün", label: "şifre@örnek" })];
    const text = await exportAegis(input, [], { password: "pw-one-pw" }, deps);
    const back = await parseAegis(JSON.parse(text), "pw-one-pw");
    expect(back.accounts).toEqual(input.map(strip));
  }, 30_000);
});
