# claviger

**An open-source two-factor authenticator for Chrome and Firefox.** claviger keeps your TOTP, HOTP and Steam Guard codes in an encrypted vault on your own device, and puts the right code in front of you when a site asks for it.

[Türkçe](README.tr.md)

<p align="center">
  <img src="docs/media/claviger-en.gif" alt="claviger fills a two-factor code into a sign-in page with Alt+Shift+O" width="800">
</p>

> **Status: 1.0.** The browser store listings are on the way; until they are live, download claviger from [Releases](https://github.com/oballi/claviger/releases/latest) (see below). Keep an exported backup either way.

## Features

### Your codes, where you need them

- TOTP, HOTP and Steam Guard codes with a countdown for each one.
- **This site:** accounts you linked to a site appear at the top when you are on that site. Nothing is guessed from names.
- **Fill on request:** press a shortcut (Alt+Shift+O by default) or right-click a code field and choose "Fill with claviger". It only fills accounts linked to the page's site, only on https, and checks the page again right before writing.
- **Add accounts** by scanning a QR code on the screen, from an image file, by pasting an image (Ctrl+V), or by typing the setup key.
- **Organize** with groups, pinned accounts, search and a sort mode for drag-and-drop ordering.
- **Your layout:** open claviger as a popup (small, medium or large), in its own window or in the side panel. Normal, Compact or Hidden view; in Hidden view an eye button shows one code for 10 seconds. Light, dark or system theme; English or Turkish.

### Security

- Every account is encrypted with AES-256-GCM. The key is protected by your master password (Argon2id) and an optional recovery code. Details: [docs/vault-format.md](docs/vault-format.md).
- You choose when it locks: when the browser closes, when the screen locks, after 15 minutes, 1 hour or 4 hours of inactivity, or never. You can also assign a keyboard shortcut that locks it at once.
- Exporting and changing security settings ask for the password again, and so does showing a secret key unless you turn that off. The lock settings themselves are sealed with the vault key, so they cannot be changed behind your back.
- The clipboard is cleared 1 minute after you copy a code (30 seconds or never are also available).
- Deleted accounts stay in **Recently deleted** for 30 days, and encrypted copies of the vault are made on this device every day and before risky changes (the last 7 are kept).

### Moving in and out

- **Import** from Google Authenticator, the Authenticator extension, Aegis, 2FAS, Proton Authenticator, Bitwarden, andOTP, FreeOTP+, Stratum (Authenticator Pro), Raivo and plain `otpauth://` links. Encrypted backups from Aegis, 2FAS, Proton, andOTP, Stratum and the Authenticator extension are supported too. You see exactly what will be added before anything is saved.
- **Find duplicates** and merge them, with undo.
- **Export** an encrypted `.claviger` backup (recommended), an Aegis-compatible file (encrypted or plain), or a plain `otpauth://` list.
- **Move to a phone:** show one account as a QR code, or several accounts as Google Authenticator transfer QR codes. They hide themselves after a short time.
- A reminder appears when you have not exported a backup for a while (30 days by default).

## Privacy

claviger has no account, no server and no analytics. The vault stays in your browser's local storage unless you turn on browser sync, and even then only encrypted data is synced. The only network request is the optional clock check, which you start yourself and which contacts `www.google.com` once. No remote code or fonts are loaded.

## Permissions

| Permission                  | Why                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `storage`                   | Keep the encrypted vault, local copies and settings.                                          |
| `alarms`, `idle`            | Lock timers, screen-lock detection and daily local copies.                                    |
| `activeTab`, `scripting`    | Fill a code into the current page, only when you ask.                                         |
| `clipboardWrite`            | Copy codes.                                                                                   |
| `contextMenus`              | The right-click "Fill with claviger" entry.                                                   |
| `offscreen` (Chrome)        | Clear the clipboard after the time you chose; the background service has no clipboard access. |
| `sidePanel` (Chrome)        | Show claviger in the side panel when you pick that open mode.                                 |
| `www.google.com` (optional) | Requested only when you run the clock check.                                                  |

## Install from a release

Download the files for your browser from the [latest release](https://github.com/oballi/claviger/releases/latest).

- **Chrome, Edge, Brave (116+):** download `claviger-<version>-chrome.zip` and unzip it into a folder you will keep (the browser loads the extension from there). Open `chrome://extensions`, turn on _Developer mode_, choose _Load unpacked_ and select that folder. Keep the folder in the same place: the extension's data is tied to it.
- **Firefox (140+):** until the add-on is signed on addons.mozilla.org, Firefox only accepts it as a temporary add-on, which is removed when Firefox closes. Download `claviger-<version>-firefox.zip`, open `about:debugging#/runtime/this-firefox`, choose _Load Temporary Add-on_ and select the zip.

`SHA256SUMS.txt` in the release lists the checksums of the files.

## Install from source

You need Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm --filter @claviger/extension build          # Chrome  → apps/extension/.output/chrome-mv3
pnpm --filter @claviger/extension build:firefox  # Firefox → apps/extension/.output/firefox-mv3
```

- **Chrome (116+):** open `chrome://extensions`, turn on _Developer mode_, choose _Load unpacked_ and select `apps/extension/.output/chrome-mv3`.
- **Firefox (140+):** open `about:debugging#/runtime/this-firefox`, choose _Load Temporary Add-on_ and select any file in `apps/extension/.output/firefox-mv3`.

To rebuild the exact Firefox package from a source archive, see [docs/build-from-source.md](docs/build-from-source.md). The release policy is in [docs/versioning.md](docs/versioning.md).

## Project layout

| Path             | What it is                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/core`  | Platform-independent TypeScript: OTP algorithms, the encrypted vault, importers and exporters. No browser APIs. |
| `packages/ui`    | The shared React interface (popup and management pages) and the message contract.                               |
| `apps/extension` | The browser extension (WXT): background service, browser integration and tests.                                 |

## Contributing and security

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Translations: [docs/i18n.md](docs/i18n.md).
- **Please do not report security problems in public issues.** See [SECURITY.md](SECURITY.md).
- This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Acknowledgements

claviger is inspired by [Authenticator-Extension/Authenticator](https://github.com/Authenticator-Extension/Authenticator); thanks to its maintainers and contributors. Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
