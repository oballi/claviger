# otp-vault

**An open-source two-factor authenticator for your browser.** otp-vault generates TOTP, HOTP and Steam Guard codes inside an encrypted vault that never leaves your device unless you choose browser sync.

[Türkçe](README.tr.md)

> **Status: early development (0.x).** otp-vault is not yet published in any browser store. Until 1.0.0 it can only be installed from source. Expect breaking changes; always keep an exported backup.

## Features

- **Encrypted vault.** Every account is encrypted with AES-256-GCM. The key is protected by your master password (Argon2id) and, optionally, a recovery code. See [docs/vault-format.md](docs/vault-format.md).
- **You choose when it locks.** Lock when the browser closes, also when the screen locks, after 15 min / 1 h / 4 h of inactivity, or never. Showing a secret, exporting and changing security settings always ask for the password again.
- **Local first.** The vault lives in the browser's local storage by default. Browser sync is opt-in and only ever stores encrypted data.
- **Site-aware.** Accounts can be linked to the sites they belong to, so the right code is shown first.
- **Imports** from Google Authenticator, the Authenticator extension, Aegis, 2FAS and plain `otpauth://` links. A preview shows exactly what will be added; duplicates are skipped.
- **Backups.** Encrypted `.otpvault` export (recommended) or a plain `otpauth://` list for moving to another app.
- **Chrome and Firefox** (Manifest V3), with minimal permissions and no remote code, fonts or analytics.

Planned for later 0.x releases: scanning QR codes from the screen, on-demand autofill, clock-drift check and automatic local snapshots. See [docs/versioning.md](docs/versioning.md) for the release policy.

## Building from source

Requirements: Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm --filter @otp-vault/extension build          # Chrome  → apps/extension/.output/chrome-mv3
pnpm --filter @otp-vault/extension build:firefox  # Firefox → apps/extension/.output/firefox-mv3
```

- **Chrome:** open `chrome://extensions`, enable _Developer mode_, choose _Load unpacked_ and select `apps/extension/.output/chrome-mv3`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose _Load Temporary Add-on_ and select any file in `apps/extension/.output/firefox-mv3`.

## Project layout

| Path             | What it is                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/core`  | Platform-independent TypeScript: OTP algorithms, the encrypted vault, importers and exporters. No browser APIs. |
| `apps/extension` | The browser extension (WXT + React).                                                                            |

## Contributing and security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- **Do not report security problems in public issues.** See [SECURITY.md](SECURITY.md).
- This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Acknowledgements

otp-vault is inspired by [Authenticator-Extension/Authenticator](https://github.com/Authenticator-Extension/Authenticator). Thanks to its maintainers and contributors. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
