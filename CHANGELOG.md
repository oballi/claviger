# Changelog

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
