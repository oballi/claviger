# Versioning

claviger follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

## Before 1.0.0: `0.y.z`

| Change                                          | Bump            | Example       |
| ----------------------------------------------- | --------------- | ------------- |
| Bug fix or small improvement users don't notice | `z`             | 0.1.0 → 0.1.1 |
| New feature or noticeable behaviour change      | `y` (reset `z`) | 0.1.1 → 0.2.0 |

- No release is published to the browser stores (Chrome Web Store, Firefox Add-ons, Edge Add-ons) before 1.0.0. 0.x releases are installed from source or from GitHub releases.
- **1.0.0 is the first store release.**

### Roadmap

| Version | Scope                                                                              |
| ------- | ---------------------------------------------------------------------------------- |
| 0.0.1   | Core library, extension foundation and user interface (runs in developer mode)     |
| 0.1.0   | QR scanning, on-demand autofill, clock check, automatic local snapshots, packaging |
| 0.2.0+  | Further features and feedback                                                      |
| 1.0.0   | Store launch                                                                       |

### Preview users: the rename to claviger

- Firefox: the extension id changed to `claviger@claviger.app`, so Firefox treats it as a new extension. Export an encrypted backup before updating, then import it. Settings, trash and automatic copies are not part of the backup and do not carry over; data synced under the old id stays in Firefox Sync, unused.
- Chrome: the unpacked preview keeps its folder; only the contents change. If the extension has to be loaded again, the same backup note applies.
- Old `.otpvault` backups still import; new backups are written as `.claviger`. A backup made with the new preview cannot be restored into an older preview.

## From 1.0.0: strict SemVer

- **MAJOR:** a change that breaks users, for example dropping support for a browser version or no longer opening an old backup format.
- **MINOR:** a backwards-compatible feature.
- **PATCH:** a backwards-compatible fix.

## Rules

1. **Store format.** The manifest version may contain only numbers and dots (up to four parts, each 0–65535) with no `-beta` style suffixes, and every upload must be higher than the previous one. A rollback ships as a new, higher version. Test builds may use a fourth part (`1.2.0.1`).
2. **One version for the repository.** All packages (root, `@claviger/core`, `@claviger/ui`, `@claviger/extension`) carry the same version, tagged `vX.Y.Z`. `@claviger/core` is not published to npm.
3. **Single source.** The extension manifest reads its version from `apps/extension/package.json`; it is never written by hand in a second place.
4. **Data formats are versioned separately.** The vault header `format`, the record `v` and the `.claviger` backup `version` are integers independent of the app version (see [vault-format.md](vault-format.md)). A release that raises one of them must migrate older data automatically and without loss, and must never modify data written by a newer version.
5. **Commits and changelog.** Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:` …). Release tooling derives the next version and `CHANGELOG.md` from them.
6. **Releasing.** `pnpm release x.y.z` bumps the versions, writes the CHANGELOG, commits and tags locally; push by hand and only with the user's approval. `lint:firefox` uses `--self-hosted` (skips AMO-only update checks); remove it before uploading to AMO.
