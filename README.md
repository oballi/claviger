# claviger

**An open-source two-factor authenticator for your browser.** claviger generates TOTP, HOTP and Steam Guard codes inside an encrypted vault that never leaves your device unless you choose browser sync.

[Türkçe](README.tr.md)

> **Status: early development (0.x).** claviger is not yet published in any browser store. 0.1.0 is tagged, but until 1.0.0 it can only be installed from source. Expect breaking changes; always keep an exported backup.

## Features

- **Encrypted vault.** Every account is encrypted with AES-256-GCM. The key is protected by your master password (Argon2id) and, optionally, a recovery code. See [docs/vault-format.md](docs/vault-format.md).
- **You choose when it locks.** Lock when the browser closes, also when the screen locks, after 15 min / 1 h / 4 h of inactivity, or never. Exporting and changing security settings always ask for the password again; so does showing a secret key, unless you turn that off.
- **Local first.** The vault lives in the browser's local storage by default. Browser sync is opt-in and only ever stores encrypted data.
- **Site-aware.** Accounts can be linked to the sites they belong to, so the right code is shown first. The popup lists the accounts you linked to the current site first.
- **Fill on request.** The Alt+Shift+O shortcut or the right-click "Fill with claviger" menu types the code into the current page. It only fills accounts linked to that site, only on https pages, re-checks the page right before writing, and never hands the secret to the page.
- **QR codes.** Scan a QR code from the screen (frozen capture, automatic detection or area selection) or import one from an image file. Decoding happens locally.
- **Automatic local copies.** Encrypted copies are made on this device daily and before risky changes; the last 7 are kept. Restoring only adds accounts that are missing. An empty vault offers a restore, and a corrupt vault can be moved aside without deleting it. Changing the password or recovery code re-keys these copies too.
- **Display and clipboard.** Display modes Normal, Compact and Hidden. Optionally clear the clipboard 30 s or 1 min after copying a code. A reminder appears if a recovery code was never confirmed as saved.
- **Open mode and size.** Open claviger as a popup (small, medium or large), a separate window or a side panel (Firefox: sidebar). The code row can be revealed one at a time in Hidden mode. The language can be set to System, Turkish or English. A reminder offers a backup after a number of days without a file export.
- **Organizing.** Reorder accounts by drag and drop; adding an account with an existing name shows a warning.
- **Optional clock check.** Compares your clock with one HTTPS source (`www.google.com`). It is off by default and the browser asks for that permission only for the request.
- **Imports** from Google Authenticator, the Authenticator extension, Aegis, 2FAS, Proton Authenticator (plain and encrypted), Bitwarden (unencrypted JSON), andOTP (plain and encrypted), FreeOTP+ (JSON), Stratum / Authenticator Pro (plain and encrypted), Raivo (JSON) and plain `otpauth://` links. QR images can be pasted (Ctrl+V) or dropped; duplicate accounts can be found and merged. A preview shows exactly what will be added; duplicates are skipped.
- **Backups.** Encrypted `.claviger` export (recommended) an Aegis-compatible file (encrypted or plain JSON), or a plain `otpauth://` list for moving to another app. Accounts can also be shown as a Google Authenticator transfer QR or as a single-account QR for another device.
- **Chrome and Firefox** (Manifest V3; Chrome 116+, Firefox 140+), with minimal permissions and no remote code, fonts or analytics.

Nothing leaves your device, except the opt-in clock check, which contacts `www.google.com`. See [docs/versioning.md](docs/versioning.md) for the release policy.

## Permissions

- `storage`: keep the encrypted vault, copies and settings.
- `alarms` and `idle`: lock timers and daily local copies.
- `activeTab` and `scripting`: fill a code into the current page, only when you ask.
- `clipboardWrite`: copy codes.
- `contextMenus`: the right-click "Fill with claviger" entry.
- `offscreen` (Chrome only): a short-lived hidden page that clears the clipboard after the time you chose, because the background service has no clipboard access.
- `sidePanel` (Chrome only): show claviger in the browser side panel when you pick that open mode.
- Optional `www.google.com`: requested only for the clock check.

## Building from source

Requirements: Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm --filter @claviger/extension build          # Chrome  → apps/extension/.output/chrome-mv3
pnpm --filter @claviger/extension build:firefox  # Firefox → apps/extension/.output/firefox-mv3
```

To rebuild the exact Firefox package from a source archive, see [docs/build-from-source.md](docs/build-from-source.md).

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

claviger is inspired by [Authenticator-Extension/Authenticator](https://github.com/Authenticator-Extension/Authenticator). Thanks to its maintainers and contributors. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
