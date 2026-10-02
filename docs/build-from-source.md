# Building the Firefox extension from source

This is for reviewers who want to rebuild the exact files that were submitted to addons.mozilla.org (AMO), and for anyone who wants to check a release.

## What you need

- Linux or macOS
- Node.js 22.x (checked with 22.22.2; CI uses `node-version: 22`)
- pnpm 10.34.6 (the version in `packageManager`): `npm install -g pnpm@10.34.6`
- Network access only for `pnpm install`. `pnpm-lock.yaml` pins every dependency and `--frozen-lockfile` refuses to change it. The build itself needs no network.

## The source archive

The source upload for AMO is the whole repository at the release tag, not the `-sources.zip` that `wxt zip` writes. That file contains only `apps/extension` and cannot be built alone, because the workspace packages and the lockfile live at the repository root.

The archive is made from the repository root with:

```sh
git archive --format=zip -o claviger-<VERSION>-source.zip v<VERSION>
```

## Build

Unzip the archive into an empty directory (any unzip tool works), then:

```sh
cd <that directory>
pnpm install --frozen-lockfile
pnpm --filter @claviger/extension zip:firefox
```

Outputs are in `apps/extension/.output/`:

- `clavigerextension-<VERSION>-firefox.zip`: the package that is uploaded.
- `clavigerextension-<VERSION>-sources.zip`: what WXT considers sources (only `apps/extension`); not the AMO source upload.
- `firefox-mv3/`: the unpacked extension, the files inside the package.

## Verifying

Compare the unpacked files, not the zip file (zip metadata is not part of the check):

```sh
cd apps/extension/.output/firefox-mv3
find . -type f | sort | xargs sha256sum
```

The list should match the one from the same command on the unpacked package you downloaded or were given.

## Reproducibility result

Checked on 2026-10-02 with Node 22.22.2 and pnpm 10.34.6 at commit 2dc8d4e (version 0.1.0). The archive was made with `git archive`, extracted into an empty directory, and built as above. The 43 files in `firefox-mv3` had the same SHA-256 sums in all three builds:

1. the extracted archive, first build,
2. the extracted archive, `.output` deleted and built again,
3. the working repository (`pnpm --filter @claviger/extension build:firefox`).

The zip files themselves were not compared.
