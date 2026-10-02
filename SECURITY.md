# Security policy

claviger stores second factors for people's accounts. We take security reports seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- the affected version or commit,
- the browser and operating system,
- steps to reproduce or a proof of concept,
- the impact as you understand it.

We aim to acknowledge reports within 7 days and to agree on a disclosure timeline with you. Please give us a reasonable time to release a fix before publishing details. We will credit you in the release notes unless you prefer otherwise.

## Supported versions

Before 1.0.0 only the latest 0.x release receives security fixes. The support policy for 1.x will be published with 1.0.0.

## Security model

What claviger is designed to protect against:

- **Someone reading the browser's storage** (stolen disk image, synced profile, malware that copies files): every account record is encrypted with AES-256-GCM under a random data key. That key is wrapped by a key derived from the master password with Argon2id (64 MiB, 3 iterations by default) and, optionally, by a recovery code. Records are bound to their storage key with authenticated data, so swapping records is detected. The format is documented in [docs/vault-format.md](docs/vault-format.md).
- **Web pages and other extensions:** the background service only answers messages from claviger's own pages. claviger has no persistent content scripts; autofill (context menu or Alt+Shift+O) injects a small function on demand into the active tab only, for an account you linked to that site.
- **Online password guessing:** after three wrong passwords each attempt waits longer (2 s doubling up to 60 s). Data is never deleted because of wrong attempts. This throttle only slows the interface; see "Known limitations" for offline guessing.
- **Shoulder-surfing and casual access:** exporting, changing the password, lock policy, storage area or recovery code all require the password again. Showing a secret key asks too, unless the user turns that off. Each confirmation is single-use and valid for 60 seconds.

Out of scope:

- **A compromised browser or operating system.** Malware running as you can read the unlocked vault from memory or capture your password.
- **Clearing memory on lock.** JavaScript cannot guarantee that secrets are wiped from memory, so claviger does not claim it.
- **The "never lock" policy.** It deliberately keeps the vault key on disk; anyone with access to the computer can see your codes.
- **Plain-text exports.** They contain unencrypted secrets by design.

## Known limitations (accepted for 1.0)

- **Offline guessing.** The attempt throttle slows only the interface. An attacker who holds a copy of the vault header guesses offline at Argon2id speed, so use a strong password.
- **The data key is not rotated** when the password or recovery code changes. Whoever holds an old copy of the header and knows the old password can still open data protected by that key. Rotation is planned after 1.0.
- **Storage writers (tombstones and records).** Someone who can write the browser's extension storage can delete a tombstone and replay an older record (resurrecting a deleted account) or roll an edit back. They cannot read or forge data.
- **Lock policy and "ask for password to reveal".** Both are sealed under the data key and stay on this device (`storage.local`, never `sync`). A storage writer can at most restore an older sealed value. An old sealed "never lock" record exists only from a time when the data key itself was on disk, and that key is not rotated, so rolling back adds little. A rolled-back "do not ask to reveal" drops the prompt only on a vault that is already unlocked. "Never lock" still keeps the key on disk by design.
- **Downgrade by deleting the seal.** A storage writer can delete the sealed lock record and edit the plaintext mirror of the setting to turn a timeout or screen-lock policy into plain "lock when the browser closes". The record is sealed again at the next unlock and the change is visible in Settings. The plaintext mirror can only tighten the policy, never relax it. Accepted.
- **Synced vaults share the sealed record.** The sealed lock record is bound to the vault (same data key and vault id), not to the device. With a vault in `sync`, another device's genuine record also opens on this one. Using it against this device needs that device's local storage, which under "never lock" already holds the data key. A per-device random id is planned.
- **Autofill trusts subdomains.** Autofill accepts every subdomain of a linked registrable domain; host-level linking is planned.

## Hardening practices

- Cryptography only through WebCrypto and `hash-wasm`; no custom primitives.
- No remote code, fonts or analytics; a strict extension content security policy.
- Dependencies are pinned through the lockfile and kept to a minimum.
- Untrusted input (imports, storage) is validated with schemas and limits. Errors never include secrets or decrypted data.
