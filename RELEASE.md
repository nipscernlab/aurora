# Releases & toolchain bundle

AURORA's source tree intentionally **does not** ship the SAPHO toolchain.
Those binaries live in GitHub Releases. This keeps the repo clone fast (a few
MB instead of ~1 GB) and the git history small.

The FOSS toolchain is consolidated into **one** pinned MSYS2/mingw64 bundle:
`components/Packages/msys/` carries iverilog, yosys, verilator, gcc15, perl,
make, ccache and a Python 3.12 whose cocotb ships **both** VPIs (Icarus +
Verilator). Pinned: gcc 15 and Python 3.12 (newer breaks the cocotb build);
everything else tracks the latest MSYS2 package. netlistsvg runs in-process
from `@silimate/netlistsvg` (npm). gtkwave-nipscern (the display fork, with
`fst2vcd`) and the YANC compilers are separate downloads.

## What lives where

| Artefact                        | Location                            |
|---------------------------------|-------------------------------------|
| Renderer / main process source  | This repo (`js/`, `main/`, …)       |
| Unified mingw toolchain bundle   | GitHub Release `msys-vX` (`nipscernlab/aurora-toolchain`) |
| gtkwave-nipscern fork            | Release in `nipscernlab/gtkwave-nipscern` |
| YANC compilers (cmmcomp, …)      | Release in `nipscernlab/yanc`       |
| End-user installer (`.exe`)      | GitHub Release per app version      |
| `latest.yml` for auto-updater    | GitHub Release per app version      |

## End-user flow

End users do not interact with the bundle directly. They download
`sapho-aurora-Setup-vX.Y.Z.exe` from Releases and run it; the installer ships
the toolchain (baked in at build time by `npm run bootstrap`). A source clone
runs `npm run bootstrap`, which downloads the `msys-vX` bundle (re-fetched if
the cocotb sentinel `…/cocotb/libs/libcocotbvpi_verilator.a` is missing),
gtkwave-nipscern and the YANC compilers.

## Maintainer flow

### One-time: cut the unified toolchain (msys) bundle

```powershell
# From a checkout where components/Packages/msys/ is populated correctly
# (pinned gcc15 + python3.12 mingw snapshot with cocotb baked in — built by
# the nipscernlab/aurora-toolchain CI pipeline).
cd components/Packages
7z a -tzip -mx=5 ..\..\aurora-msys-v1.zip msys   # layout: msys\... at the zip root

gh release create "msys-v1" ..\..\aurora-msys-v1.zip `
   --repo nipscernlab/aurora-toolchain --prerelease `
   --title "AURORA unified mingw bundle v1" `
   --notes "iverilog 13 + yosys + verilator 5.048 + gcc15 + python3.12 (cocotb, both VPIs)."
```

Bump `MSYS_TAG` / `MSYS_FILENAME` in `components/Scripts/download-toolchain.js`
when cutting a new version.

### Cut an app release

The single flow is **release-please** (`.github/workflows/release-please.yml`):
every push to `main` keeps a release PR open that bumps the version + manifest
and updates `CHANGELOG.md`. Merge that PR to publish the GitHub Release, which
**triggers `release.yml`** (`on: release: published`) to build the installer and
upload the `.exe` + `latest.yml`. The auto-updater takes it from there.

Manual fallback: run the **Release** workflow via `workflow_dispatch`, or

```powershell
npm version patch        # or minor / major — generates a tagged commit
git push --follow-tags
```

then publish a GitHub Release at that tag.

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
