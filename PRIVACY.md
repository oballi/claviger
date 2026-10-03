# Privacy policy

[Türkçe](PRIVACY.tr.md)

Last updated: 3 October 2026. Applies to the claviger browser extension for Chrome and Firefox, version 1.0 and later.

claviger does not collect, transmit, sell or share personal data. It has no analytics, no tracking, no user accounts and no servers of its own. The developers cannot see your accounts, codes, passwords or how you use the extension.

## What is stored, and where

Everything claviger stores is kept in your browser's extension storage on your device.

- **The vault:** your accounts (service name, account name, secret key, code settings, linked sites), their order, pins and groups. Every account and the order list are encrypted with AES-256-GCM. The encryption key is protected by your master password (Argon2id) and, if you create one, a recovery code. Your password is never stored. The unencrypted header holds only the vault id, the key-derivation parameters and the encrypted (wrapped) keys. The format is documented in [docs/vault-format.md](docs/vault-format.md).
- **Deletion markers:** when you delete an account, a small unencrypted marker with the account's random id and the deletion time is kept for 90 days, so the deletion reaches your other devices if you use browser sync. It contains no account data.
- **Recently deleted:** deleted accounts are kept encrypted on this device for 30 days so you can undo a delete. They are never synced.
- **Automatic copies:** encrypted copies of the vault, made daily and before risky changes; the last 7 are kept. They stay on this device and are protected like the vault.
- **Settings:** theme, language, view, open mode, lock and clipboard settings, backup reminder dates and the clock correction. Your lock settings are also sealed with the vault key. Settings stay on this device and are never synced.
- **The unlocked key:** while the vault is unlocked, its key is kept in the browser's session storage, which lives in memory and is cleared when the vault locks or the browser closes. If you choose the "Never" lock setting, the key is also kept on disk, and anyone with access to your computer can see your codes.

## Browser sync (optional, off by default)

When you set up claviger, or later on the Backup page, you can choose "Browser sync" instead of "This device only". With browser sync, the vault (the encrypted accounts and order list, the header with the wrapped keys, and the deletion markers) is written to your browser's sync storage. Your browser then copies it to your other devices signed in to the same browser account, and the browser vendor (for example Google or Mozilla) stores and transfers it under its own privacy policy.

Only the vault is synced. Account names, secret keys, groups and sites are encrypted before they leave the device, and your password, the unlocked key, settings, automatic copies and recently deleted accounts are never written to sync storage. Switching back to "This device only" moves the vault back and removes it from sync storage.

## Network requests

claviger loads no remote code, scripts or fonts, and sends nothing to its developers.

The only network request it can make is the optional **clock check** on the Preferences page, which you start yourself when codes are rejected because your computer's clock may be wrong:

1. The browser asks you to allow access to `www.google.com` for this check. If you refuse, nothing is sent.
2. claviger sends one `HEAD` request to `https://www.google.com/generate_204` without cookies and without a referrer, and reads only the time from the `Date` header of the answer.
3. The permission is removed right after the check.

The request contains no account data. Like any web request it reaches Google's server from your IP address with your browser's standard headers, and Google handles it under its own privacy policy.

## Web pages

- **This site:** when you open claviger, it reads the address of the current tab to show the accounts you linked to that site. The address is used on the device only and is not stored or sent.
- **Filling codes:** when you ask for it (the Alt+Shift+O shortcut, the right-click "Fill with claviger" entry, or Shift+Enter in the popup), claviger injects a small function into the current tab that writes the one-time code into the code field. It does this only for an account you linked to that site, only on https pages (plain http only for local addresses such as `localhost`), and never gives the secret key to the page. claviger runs no permanent scripts on web pages.
- **Scanning a QR code from the screen:** after you start a scan, claviger captures the visible part of the current tab. The image is decoded on your device, kept in memory for at most 60 seconds, and never stored or sent.

## Clipboard

When you copy a code, claviger writes it to the clipboard. By default it clears the clipboard 1 minute later (you can choose 30 seconds or never) by writing a blank value, so anything else you copied in the meantime is cleared too. claviger never reads your clipboard. An image you paste yourself with Ctrl+V (to add an account from a QR image) is read only from that paste and decoded on your device.

## Exports and backups

Encrypted `.claviger` backups and encrypted Aegis exports are protected by a password you choose. A plain `otpauth://` list or a plain Aegis export is not encrypted; you decide where to save it. Transfer QR codes for a phone are shown on screen only and hide themselves after a short time.

## Permissions

| Permission                  | Why                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `storage`                   | Keep the encrypted vault, local copies and settings.                                                     |
| `alarms`, `idle`            | Lock timers, screen-lock detection, daily local copies and the clipboard timer.                          |
| `activeTab`, `scripting`    | Read the current tab's address and fill a code into it, only after your action; capture it for QR scans. |
| `clipboardWrite`            | Copy codes and clear them again.                                                                         |
| `contextMenus`              | The right-click "Fill with claviger" entry.                                                              |
| `offscreen` (Chrome)        | Clear the clipboard after the time you chose; the background service has no clipboard access.            |
| `sidePanel` (Chrome)        | Show claviger in the side panel when you pick that open mode.                                            |
| `www.google.com` (optional) | Requested only when you run the clock check, and removed after it.                                       |

## Children

claviger is a general-purpose tool and does not knowingly collect data from anyone, including children.

## Contact

claviger is open source under the MIT license: <https://github.com/oballi/claviger>.

- Questions about this policy: open an issue at <https://github.com/oballi/claviger/issues>.
- Security problems: please report them privately through the repository's **Security** tab ("Report a vulnerability"), not in public issues. See [SECURITY.md](SECURITY.md).

## Changes

If this policy changes, the new version is published in this file and the date above is updated. The history of the file shows every change.
