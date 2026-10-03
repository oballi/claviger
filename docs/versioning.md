# Versioning

claviger follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Versions before 1.0.0 (`0.y.z`) were previews and were never published to a browser store. **1.0.0 is the first store release.**

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
6. **Releasing.** `pnpm release x.y.z` bumps the versions, writes the CHANGELOG, commits and tags locally; it never pushes. A maintainer pushes the commit and the tag. `lint:firefox` uses `--self-hosted` (skips AMO-only update checks); remove it before uploading to AMO.
