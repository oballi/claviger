# Changelog

## 1.0.1 — 2026-10-03

### Changed

- The setup wizard scales up on large screens, and its Continue row stays visible at the bottom of the window on long steps.

### Fixed

- Group actions on the accounts page no longer run into the panel edge; they move under the group name together when space is short.
- After moving an account into a collapsed group, focus no longer gets lost in the popup.

### Docs

- Privacy policy (English and Turkish) and an animated demo in the README.

## 1.0.0 — 2026-10-03

First public release (GitHub).

### Features

- Groups, pinning, drag-and-drop ordering and a sort mode in the popup; a "recently deleted" bin with undo.
- Imports from the Authenticator extension, Google Authenticator (migration QR), Aegis, 2FAS, andOTP, FreeOTP+, Proton Authenticator, Bitwarden, Stratum (Authenticator Pro) and Raivo, plus plain `otpauth://` lists; exports to an encrypted `.claviger` backup, Aegis and Google Authenticator QR codes; move a single account to a phone with a QR.
- Duplicate finder with safe merge.
- Preferences tab: theme (also a one-click toggle in the popup and manage headers), language, code view, open mode (popup, side panel, window) and popup size; backup reminder; lock shortcut.
- Popup keyboard use: search is focused on open, typing goes to search, arrows move, Enter copies, Shift+Enter fills the linked site, Esc clears or closes.
- The next code appears dimmed in the last seconds of a period, and copying then gives the next code.
- Copy feedback in the row itself, a seconds counter when time runs out, the account name on the "This site" row.
- A welcome screen with the three ways to add a first account.
- The setup wizard is a compact centred card with Continue right under the form.
- Show/hide buttons on every password field and a live "passwords don't match" hint.
- The clipboard is cleared 1 minute after copying by default.

### Fixes

- The row menu no longer overlaps the codes; delete confirmations focus Cancel.
- Inline errors next to the field in the add form; pasting an `otpauth://` link fills the form.
- Clearer wording across the app and aligned radio buttons in setup and settings.
- Automatic copies of an empty vault are no longer kept.
- Group actions on the accounts page stay together on narrow panels.

### Security

- The lock policy and the "ask for the password to reveal" setting are now sealed under the data key. Preview users: they are re-sealed on first unlock, so "Never lock" and "do not ask for the password to reveal" must be chosen once again.
- Upstream Authenticator imports cap the number of distinct keys, report malformed encrypted entries, and skip Aegis key slots with unreasonable scrypt parameters.
- Moving the vault between storage areas verifies a canonical form of every record.
- Copying a secret key clears the clipboard as configured.

### Changed

- The `fillCode` message was removed; filling goes through the shortcut and context menu only.
- Legacy local keys (collapsed groups, theme cache) are validated, then removed even when the new key exists.

### Fixed

- An entry with the id `key` in an upstream backup is skipped only when it is the legacy key object; otherwise it is imported or reported.

## 0.1.0 — 2026-10-02

### Features

- Fill a code into the current page on request: "Doldur" button in the popup, Alt+Shift+O shortcut and a right-click "Insert 2FA code" menu. Fills only linked https sites, re-checks the page right before writing and never sends the secret to the page.
- Scan a QR code from the screen (frozen capture, automatic detection, area selection) and import accounts from QR images, decoded locally.
- Optional clock check against one HTTPS source; the permission is requested for that request only.
- Encrypted automatic copies on this device: daily and before risky changes, last 7 kept, restore adds only missing accounts; restore offer for an empty vault; a corrupt vault can be moved aside without deleting it.
- Display modes Normal, Compact and Hidden; optional clipboard clearing after 30 s or 1 min; reminder when a recovery code was never confirmed as saved.
- Drag-and-drop ordering, same-name warning when adding, per-site memory that orders the popup.
- Localized extension name and description (TR/EN), single-source version, local release script; Firefox 140 or newer.

### Security

- Changing the password or recovery code also re-keys the automatic copies, so the old secret no longer opens them.

### Performance

- The popup no longer loads the core library (651 kB → 298 kB of script).

## 0.0.1 — 2026-10-02

- Core: TOTP/HOTP/Steam codes, encrypted vault (WebCrypto + Argon2id), importers and exporters, domain matching.
- Extension foundation: WXT MV3 background VaultService, typed RPC with sender checks, clipboard handling, Chrome and Firefox builds.
- UI: popup and manage page in Turkish and English, account add/edit, backup, security settings.
