import { scrypt } from "hash-wasm";
import type { AccountInput } from "../account/account";
import { toArrayBuffer, utf8Encode } from "../encoding/bytes";
import { toBase64 } from "../encoding/base64";
import { toHex } from "../encoding/hex";
import type { VaultDeps } from "../ports";
import type { VaultGroup } from "../vault/format";

// ~32 MiB: inside the importer's own bounds, and Aegis's own default.
const SCRYPT = { n: 32768, r: 8, p: 1 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_BYTES = 16;

type ExportAccount = AccountInput & { id: string; groupId?: string };

// Aegis keeps the tag apart from the ciphertext and uses no AAD.
async function gcmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", toArrayBuffer(key), "AES-GCM", false, ["encrypt"]);
  const out = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce) },
      k,
      toArrayBuffer(plaintext),
    ),
  );
  return { ct: out.subarray(0, out.length - TAG_BYTES), tag: out.subarray(out.length - TAG_BYTES) };
}

function buildDb(
  accounts: ExportAccount[],
  groups: VaultGroup[],
  pinned: ReadonlySet<string>,
  random: VaultDeps["random"],
) {
  const groupUuids = new Map(groups.map((g) => [g.id, random.uuid()]));
  return {
    version: 3,
    groups: groups.map((g) => ({ uuid: groupUuids.get(g.id), name: g.name })),
    entries: accounts.map((a) => {
      const group = a.groupId ? groupUuids.get(a.groupId) : undefined;
      return {
        type: a.type,
        uuid: UUID.test(a.id) ? a.id : random.uuid(),
        name: a.label,
        issuer: a.issuer,
        note: "",
        favorite: pinned.has(a.id),
        icon: null,
        info: {
          secret: a.secret,
          algo: a.algorithm,
          digits: a.digits,
          ...(a.type === "hotp" ? { counter: a.counter } : { period: a.period }),
        },
        groups: group ? [group] : [],
      };
    }),
  };
}

/** Aegis-compatible vault: encrypted when a password is given, otherwise PLAIN JSON with secrets in the clear. */
export async function exportAegis(
  accounts: ExportAccount[],
  groups: VaultGroup[],
  opts: { password?: string; pinned?: ReadonlySet<string> },
  deps: Pick<VaultDeps, "random">,
): Promise<string> {
  const db = buildDb(accounts, groups, opts.pinned ?? new Set(), deps.random);
  if (opts.password === undefined) {
    return JSON.stringify({ version: 1, header: { slots: null, params: null }, db }, null, 2);
  }

  const master = deps.random.bytes(32);
  const salt = deps.random.bytes(32);
  const kek = await scrypt({
    password: utf8Encode(opts.password),
    salt,
    costFactor: SCRYPT.n,
    blockSize: SCRYPT.r,
    parallelism: SCRYPT.p,
    hashLength: 32,
    outputType: "binary",
  });
  const slotNonce = deps.random.bytes(12);
  const slot = await gcmEncrypt(kek, slotNonce, master);
  const dbNonce = deps.random.bytes(12);
  const body = await gcmEncrypt(master, dbNonce, utf8Encode(JSON.stringify(db)));
  return JSON.stringify(
    {
      version: 1,
      header: {
        slots: [
          {
            type: 1,
            uuid: deps.random.uuid(),
            key: toHex(slot.ct),
            key_params: { nonce: toHex(slotNonce), tag: toHex(slot.tag) },
            n: SCRYPT.n,
            r: SCRYPT.r,
            p: SCRYPT.p,
            salt: toHex(salt),
            repaired: true,
          },
        ],
        params: { nonce: toHex(dbNonce), tag: toHex(body.tag) },
      },
      db: toBase64(body.ct),
    },
    null,
    2,
  );
}
