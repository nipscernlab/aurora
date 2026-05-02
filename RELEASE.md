# Releases & toolchain bundle

AURORA's source tree intentionally **does not** ship the SAPHO toolchain
(Icarus Verilog, GTKWave, Yosys, netlistsvg, 7-Zip, etc.). Those binaries
live in GitHub Releases. This keeps the repo clone fast (a few MB instead
of half a gigabyte) and the git history small.

## What lives where

| Artefact                        | Location                       |
|---------------------------------|--------------------------------|
| Renderer / main process source  | This repo (`js/`, `main/`, …)  |
| Bundled toolchain binaries      | GitHub Release `toolchain-vX`  |
| End-user installer (`.exe`)     | GitHub Release per app version |
| `latest.yml` for auto-updater   | GitHub Release per app version |

The `electron-builder` configuration in `package.json` already publishes
the installer and the `latest.yml` manifest on tag push (see
`.github/workflows/release.yml`).

## End-user flow

End users do not interact with the toolchain bundle directly. They:

1. Download `AuroraIDE-Setup-vX.Y.Z.exe` from
   [Releases](https://github.com/nipscernlab/Aurora/releases/latest).
2. Run the installer.
3. On first launch, AURORA verifies that `components/Packages/` is
   present. If it is missing or out of date, the IDE downloads the
   matching `aurora-toolchain-vX.zip` from the pinned release and
   extracts it next to the executable.

The toolchain version pin lives in `package.json` under `aurora.toolchain`
so the IDE can refuse to start with a mismatched bundle.

## Maintainer flow

### One-time: cut a toolchain release

```powershell
# From a clean checkout where components/Packages/ is populated correctly
$ver = "v1"
Compress-Archive -Path components/Packages/* `
                 -DestinationPath aurora-toolchain-$ver.zip -Force

gh release create "toolchain-$ver" aurora-toolchain-$ver.zip `
   --title "AURORA toolchain $ver" `
   --notes "Bundled SAPHO toolchain (iverilog, gtkwave, yosys, netlistsvg, ...)."
```

Bump `aurora.toolchain` in `package.json` to `"v1"`.

### Cut an app release

```powershell
npm version patch        # or minor / major — generates a tagged commit
git push --follow-tags
```

The `release.yml` workflow picks up the tag, builds the installer with
`electron-builder`, and publishes the `.exe` + `latest.yml` to the GitHub
Release. The auto-updater takes it from there.

## Why not just commit the binaries?

We did, originally. The git history grew to **~550 MiB** (vs. ~7 MiB of
actual source) because every replacement of `yosys.exe`, `netlistsvg.exe`,
`gtkwave.exe`, etc. created a new ~50 MiB blob in the pack.

GitHub's hard limit for a single file is 100 MiB and the soft limit for a
repo is 1 GiB. Continuing to commit the bundle would have pushed us past
both within a few releases and would have made `git clone` painful for
contributors.

See `docs/git-history-rewrite.md` for the playbook used to remove the
binaries from history.
