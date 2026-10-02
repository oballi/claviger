# Vault and backup format (version 1)

This document describes how claviger stores data so that anyone can audit it, recover their data, or write a compatible tool. Field names are exact. Binary values are standard base64. All encryption is AES-256-GCM with a 96-bit random IV; the stored `ct` is ciphertext followed by the 128-bit tag.

## Storage keys

The vault lives in one browser storage area (`local` by default, or `sync`). Every key starts with `vault:`.

| Key                 | Content                                                                                           | Encrypted                    |
| ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- |
| `vault:header`      | Format version, vault id and key slots                                                            | no (holds only wrapped keys) |
| `vault:index`       | Account order and pins                                                                            | yes                          |
| `vault:acct:<uuid>` | One account                                                                                       | yes                          |
| `vault:tomb:<uuid>` | Deletion marker `{ "deletedAt": <ms> }`, kept at least 90 days so sync can propagate the deletion | no                           |

Each account is a separate item so that browser sync can merge changes per account. Keys starting with `lock:` hold lock state; they are never written to `sync` and are not part of the vault.

## Header

```json
{
  "format": 1,
  "vaultId": "<uuid>",
  "createdAt": 1790000000000,
  "keyslots": [ <password slot>, <optional recovery slot> ]
}
```

A random 256-bit **data key (DEK)** encrypts all records. Key slots wrap the DEK; changing the password only rewrites a slot, never the records.

**Password slot**

```json
{
  "kind": "password",
  "kdf": {
    "alg": "argon2id",
    "salt": "<≥8 bytes>",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 1
  },
  "iv": "...",
  "ct": "..."
}
```

KEK = Argon2id(UTF-8 of the NFC-normalized password, salt, params), 32 bytes. The DEK is sealed with AAD `otp-vault/v1/keyslot/password/<vaultId>`. Readers reject parameters outside `memoryKiB` 8–262144, `iterations` 1–10 and `parallelism` 1–4 so a crafted file cannot freeze the browser.

**Recovery slot** (optional)

```json
{ "kind": "recovery", "kdf": { "alg": "hkdf-sha256", "salt": "..." }, "iv": "...", "ct": "..." }
```

The recovery code is 20 random bytes shown as 32 Crockford base32 characters in groups of four (`I`/`L` read as `1`, `O` as `0`). KEK = HKDF-SHA-256(code bytes, salt, info `otp-vault/recovery/v1`). AAD `otp-vault/v1/keyslot/recovery/<vaultId>`. Using the recovery code replaces it with a new one.

## Records

```json
{ "v": 1, "iv": "...", "ct": "...", "updatedAt": 1790000000000 }
```

The plaintext is UTF-8 JSON. The AAD is `otp-vault/v1/<storage key>` (for example `otp-vault/v1/vault:acct:<uuid>`), which detects records moved between keys. The outer `updatedAt` is not authenticated; it is used only to resolve sync conflicts (newer wins), and the decrypted value must also be newer than any tombstone.

**Account plaintext**

```json
{
  "id": "<uuid>", "type": "totp" | "hotp" | "steam",
  "secret": "<base32, upper case, no padding>",
  "issuer": "...", "label": "...",
  "algorithm": "SHA1" | "SHA256" | "SHA512",
  "digits": 6, "period": 30, "counter": 0,
  "domains": ["example.com"],
  "createdAt": 0, "updatedAt": 0
}
```

**Index plaintext**: `{ "order": ["<uuid>", ...], "pinned": ["<uuid>", ...], "updatedAt": 0 }`. If the index is unreadable the accounts are still shown and the index can be rebuilt.

## Encrypted backup (`.claviger`)

```json
{
  "format": "claviger-export",
  "version": 1,
  "exportId": "<uuid>",
  "createdAt": 1790000000000,
  "keyslots": [ <password slot> ],
  "payload": { "iv": "...", "ct": "..." }
}
```

A random 256-bit file key encrypts the payload with AAD `otp-vault/v1/export/<exportId>`. The password slot is built as above with `<exportId>` in place of `<vaultId>`. The payload plaintext is `{ "accounts": [ { "type", "secret", "issuer", "label", "algorithm", "digits", "period", "counter", "domains" } ] }`. Issuers and labels are encrypted too.

Groups are additive and keep `version` at 1: an account may carry `"group": "<name>"` and the payload may carry `"groups": ["<name>", ...]` (display order). Names are matched on import by case-insensitive NFC key, reusing existing groups; invalid or over-limit names import the account ungrouped. Groups that none of the imported accounts use are not created. Older readers ignore both fields and import everything ungrouped.

## Recently deleted (device-local, not part of the vault)

Deleted accounts are kept for 30 days in `storage.local` under `trash:<uuid>` so a delete can be undone. These keys are **not** part of the vault format: they never start with `vault:`, are never written to `sync`, and are not included in vault copies, exports or storage moves.

Each value is a record like any other (`{ "v": 1, "iv": "...", "ct": "...", "updatedAt": <deletedAt ms> }`), sealed with the vault's data key and AAD `otp-vault/v1/trash:<uuid>`. The plaintext is `{ "account": <account plaintext>, "deletedAt": <ms> }`; the inner `deletedAt` (authenticated) decides expiry, the outer `updatedAt` is used only to age out entries this key cannot open.

Restoring creates a new account with a fresh id (the old id keeps its tombstone, so sync cannot resurrect it elsewhere). At most 100 entries and about 200 KB are kept; the oldest go first. Because the data key is unchanged by a password change, entries stay readable; a future data-key rotation must re-seal them. Removing an entry from the list does not touch the automatic vault copies (`snapshot:*`), which may still contain the account until they rotate out. Anyone with write access to `storage.local` can put back an older `trash:<uuid>` value; it decrypts and shows up again until its authenticated `deletedAt` expires, so the bin is a convenience, not a record of what was removed.

## Device-local security record

The lock policy and the "ask for the password to reveal a secret" setting are sealed under the data key in `storage.local` under the key `lock:policy`. The key is never written to `sync`, and because it has no `vault:` prefix it is not part of snapshots, exports or storage moves.

The value is a record like any other (`{ "v": 1, "iv": "...", "ct": "...", "updatedAt": <ms> }`) with AAD `otp-vault/v1/lock:policy`. The plaintext is `{ "vaultId": "<id>", "lockPolicy": <policy>, "revealRequiresPassword": <boolean> }`. A record that is missing, does not open or names another vault is replaced by the safe default (lock when the browser closes, ask for the password to reveal). A future data-key rotation must re-seal this record.

A plaintext copy of the policy is kept in the settings as a mirror. It may only tighten behaviour (trigger a lock), never relax the sealed value.

## Accepted limitations

- **L1: tombstones are not authenticated.** `vault:tomb:<uuid>` holds plain JSON. Someone who can write storage can delete one and replay an older account record, or roll an account back to an earlier authenticated version. They cannot read or forge records.
- **L2: the data key is not rotated.** Changing the password or recovery code re-wraps the same data key. An old header copy plus the old password still opens data protected by that key. Rotation is planned after 1.0 and must also re-seal `trash:<uuid>` and `lock:policy`.

## Versioning rules

- Any incompatible change to the header, records, index or tombstones increases `format`; the backup file has its own `version`.
- A reader that finds a newer `format`, record `v` or backup `version` refuses to modify the data and reports it as unsupported instead of treating it as corrupt.
- New versions must migrate older data automatically and without loss.

## Legacy names

The project was called otp-vault before it became claviger. These identifiers are bound into existing ciphertexts and are frozen: `otp-vault/v1/<storage key>`, `otp-vault/v1/keyslot/<kind>/<scope>`, `otp-vault/recovery/v1`, `otp-vault/v1/export/<exportId>`, `otp-vault/v1/trash:<uuid>`.
Backups: new files use `"format": "claviger-export"` and the extension `.claviger`; readers also accept `"otp-vault-export"` and `.otpvault`. The encryption is identical.
