# Security policy

otp-vault stores second factors for people's accounts. We take security reports seriously and appreciate responsible disclosure.

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

What otp-vault is designed to protect against:

- **Someone reading the browser's storage** (stolen disk image, synced profile, malware that copies files): every account record is encrypted with AES-256-GCM under a random data key. That key is wrapped by a key derived from the master password with Argon2id (64 MiB, 3 iterations by default) and, optionally, by a recovery code. Records are bound to their storage key with authenticated data, so swapping records is detected. The format is documented in [docs/vault-format.md](docs/vault-format.md).
- **Web pages and other extensions:** the background service only answers messages from otp-vault's own pages. Content scripts are injected only on demand, into the matching site, to fill a code.
- **Online password guessing:** after three wrong passwords each attempt waits longer (2 s doubling up to 60 s). Data is never deleted because of wrong attempts.
- **Shoulder-surfing and casual access:** showing a secret, exporting, and changing the password, lock policy, storage area or recovery code all require the password again. Each confirmation is single-use and valid for 60 seconds.

Out of scope:

- **A compromised browser or operating system.** Malware running as you can read the unlocked vault from memory or capture your password.
- **The "never lock" policy.** It deliberately keeps the vault key on disk; anyone with access to the computer can see your codes.
- **Plain-text exports.** They contain unencrypted secrets by design.

## Hardening practices

- Cryptography only through WebCrypto and `hash-wasm`; no custom primitives.
- No remote code, fonts or analytics; a strict extension content security policy.
- Dependencies are pinned through the lockfile and kept to a minimum.
- Untrusted input (imports, storage) is validated with schemas and limits. Errors never include secrets or decrypted data.
