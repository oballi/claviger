# Vault and backup format (version 1)

This document describes how otp-vault stores data so that anyone can audit it, recover their data, or write a compatible tool. Field names are exact. Binary values are standard base64. All encryption is AES-256-GCM with a 96-bit random IV; the stored `ct` is ciphertext followed by the 128-bit tag.

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

## Encrypted backup (`.otpvault`)

```json
{
  "format": "otp-vault-export",
  "version": 1,
  "exportId": "<uuid>",
  "createdAt": 1790000000000,
  "keyslots": [ <password slot> ],
  "payload": { "iv": "...", "ct": "..." }
}
```

A random 256-bit file key encrypts the payload with AAD `otp-vault/v1/export/<exportId>`. The password slot is built as above with `<exportId>` in place of `<vaultId>`. The payload plaintext is `{ "accounts": [ { "type", "secret", "issuer", "label", "algorithm", "digits", "period", "counter", "domains" } ] }`. Issuers and labels are encrypted too.

## Versioning rules

- Any incompatible change to the header, records, index or tombstones increases `format`; the backup file has its own `version`.
- A reader that finds a newer `format`, record `v` or backup `version` refuses to modify the data and reports it as unsupported instead of treating it as corrupt.
- New versions must migrate older data automatically and without loss.
