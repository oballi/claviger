# Contributing to otp-vault

Thanks for helping! Bug reports, fixes, translations and ideas are all welcome.

## Before you start

- **Security issues** go through [SECURITY.md](SECURITY.md), never public issues.
- **Larger changes** (new features, format changes, new permissions): please open an issue first so we can agree on the approach before you invest time.
- By contributing you agree that your work is licensed under the [MIT License](LICENSE).

## Development setup

Requirements: Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm test        # all unit tests
pnpm typecheck
pnpm lint        # eslint + prettier --check
pnpm coverage    # thresholds: 90% lines/statements/functions, 85% branches
pnpm format      # run before committing
```

Run the tests of one package: `pnpm --filter @otp-vault/core test <pattern>`.

## Ground rules

- **`packages/core` stays platform-independent.** No `chrome.*` or `browser.*` APIs (lint enforces this). Browser code lives in `apps/extension`.
- **Write tests first** for behaviour changes and bug fixes. A bug fix comes with a test that fails without it.
- **Cryptography** only via WebCrypto and `hash-wasm`. Don't add crypto libraries.
- **Untrusted input** (imports, storage) may only throw `CoreError`. Never drop an account silently. Never put secrets or decrypted data into error messages or logs.
- **Storage format.** Any incompatible change to the vault header, records, index or tombstones must bump the format version and migrate existing vaults without data loss (see [docs/vault-format.md](docs/vault-format.md)).
- **Permissions.** Don't add extension permissions or host permissions without discussing it in an issue first.
- **Comments** are in English, short, and explain _why_, not _what_.
- **UI text** lives in the translation dictionaries; every key must exist in every language.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:` (optionally with a scope, e.g. `fix(core): …`). The changelog and version numbers are derived from them.
- Keep pull requests focused; one topic per PR.
- Make sure `pnpm test`, `pnpm typecheck` and `pnpm lint` pass. CI runs them on every PR.
- Describe what changed and how you tested it. For UI changes add a screenshot.

## Versioning

See [docs/versioning.md](docs/versioning.md).
