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

## Verifying / restoring components (the "doctor")

The bootstrap only runs on `prestart` / `prebuild`. That left a gap: deleting a
binary (say `surfer-aurora.exe`) and running `npm install` re-downloaded
nothing, because there is no `postinstall` triggering the bootstrap. And most
`download-*.js` only check "does the file exist?", so a **version bump** never
reached a dev who already had the previous version (only YANC, via its
`bin/.yanc-version` marker, did).

[`scripts/verify-components.js`](scripts/verify-components.js) closes both gaps.
It checks the 7 executable-bearing components by the same sentinel each
`download-*.js` uses (not file-by-file, so it survives files changing between
versions), and keeps a per-machine manifest `components/.aurora-versions.json`
(gitignored) recording the installed tag of every component — which makes a
version bump detectable for **all** of them, not just YANC. It never builds
anything; it only invokes the `download-*.js`, which fetch the pinned `.zip` /
`.exe` from the release repos.

Entry points:

| Command | Behavior |
|---------|----------|
| `npm install` (hook `postinstall`, `--postinstall` mode) | Restores anything **missing**, re-downloads anything **bumped** (pinned tag ≠ installed tag), silent when all OK. Skips entirely under CI (`CI` env set) or `AURORA_SKIP_BOOTSTRAP=1`, and never fails the install. |
| `npm run components:verify` | Interactive report + prompts to download missing, upgrade bumped, and optionally force-redownload the OK ones. |
| `node scripts/verify-components.js --report` / `--json` | Read-only status. |
| `… --yes` / `--force-all` / `--only <keys>` / `--strict` | Non-interactive restore / force-all / restrict to components / exit 1 if anything missing (CI). |

On Windows, [`scripts/verify-components.bat`](scripts/verify-components.bat) is a
double-click wrapper around the same script.

**Why postinstall is skipped in CI:** GitHub Actions starts every job with
`npm ci` on a clean VM where none of the (gitignored) binaries exist. Without
the skip, each job would try to download the whole toolchain (hundreds of MB)
even though the unit tests never touch those binaries — wasted minutes, and a
red CI whenever a release host is momentarily unreachable.

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

### Two repos, two roles

SAPHO is the project (the soft-processor platform); AURORA is its IDE. The
release split follows that naming:

| Repo | Role | What lives there |
|------|------|------------------|
| `nipscernlab/aurora` | **source** | code, CI, tags, `CHANGELOG.md`, the release-please Release (the changelog of record) |
| `nipscernlab/sapho` | **distribution** | the installer `.exe`, its `.blockmap`, and `latest.yml` — the feed every installed copy polls |

`package.json#build.publish` and `REPO_OWNER`/`REPO_NAME` in
[`main/updater.js`](main/updater.js) both point at the distribution repo, and
`DIST_REPO` in `release.yml` mirrors them. **Those three must agree** — an
installed copy polls whatever `main/updater.js` was built with, so changing one
without the others silently strands every machine already in the field.

### The token (why releases used to fail)

Because the build runs in `aurora` but publishes to `sapho`, the default
`GITHUB_TOKEN` is not enough: it is scoped to `aurora` and returns
`403 Resource not accessible by integration` when electron-builder POSTs to
`/repos/nipscernlab/sapho/releases`. That is exactly how the 2026-05-19 run
died — and why v6.3.2 ended up published by hand.

The fix is a repo secret **`SAPHO_RELEASE_TOKEN`**: a fine-grained PAT scoped
to `nipscernlab/sapho` with `Contents: read and write`. The first step of
`release.yml` probes it and fails in seconds if it is missing, expired or
read-only — rather than after the ~20 min build, at the last step, as before.

### Cut an app release

The single flow is **release-please** (`.github/workflows/release-please.yml`):
every push to `main` keeps a release PR open that bumps the version + manifest
and updates `CHANGELOG.md`. Merge that PR to publish the GitHub Release on
`aurora`, which **triggers `release.yml`** (`on: release: published`) to build
the installer and upload the `.exe`, `.blockmap` and `latest.yml` to `sapho`.
The auto-updater takes it from there.

`release.yml` gates the publish at three points, in order:

1. **Preflight** — can `SAPHO_RELEASE_TOKEN` actually write to the
   distribution repo? Runs before anything is built.
2. **Toolchain sentinels** — the `download-*.js` exit 0 on failure so an
   offline dev can still start the IDE; a release must never ship without the
   toolchain, so missing sentinels fail the job.
3. **Update-feed verification** — after publishing, the workflow re-downloads
   `latest.yml` over plain HTTPS, exactly as a client would, and checks that
   its `version`, `path` and `sha512` describe the installer that was actually
   uploaded, and that the `.blockmap` is present. A feed that disagrees with
   its installer makes **every** installed copy fail with "checksum mismatch",
   recoverable only by cutting another release — so it must never reach users.

The release notes are then mirrored from the `aurora` release onto the `sapho`
release, because the update window reads them from the distribution repo
(`fetchReleaseNotes` in `main/updater.js`) and electron-builder creates that
release with an empty body.

Manual fallback: run the **Release** workflow via `workflow_dispatch`, or

```powershell
npm version patch        # or minor / major — generates a tagged commit
git push --follow-tags
```

then publish a GitHub Release at that tag.

## Differential updates — what actually keeps the fleet cheap

The installer is ~500 MB, almost all of it the bundled toolchain. That is a
one-time cost per machine, **not** a per-update cost: electron-updater fetches
only the changed blocks. Three things make that work, and each is easy to
break by accident.

**1. The blockmap is already tuned; do not "optimise" the compression.**
`configureDifferentialAwareArchiveOptions` in app-builder-lib forces
`compression: normal`, `solid: false`, `dictSize: 1 MB` for any
differential-aware NSIS package, with the comment *"do not allow to change
compression level to avoid different packages"*. Setting
`build.compression: "maximum"` in package.json is therefore **ignored** for
the inner archive — it buys nothing. Worse, solid compression is precisely
what would destroy delta efficiency: one changed byte early in a solid stream
invalidates every block after it.

**2. The delta base is the *previous installer*, cached locally.**
`NsisUpdater` looks for `<cacheDir>/installer.exe` and diffs against it; it
never re-downloads the old installer. That file is written by the NSIS
installer itself (`copyFile "$EXEPATH" "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"`),
so **every** install seeds it — including the very first one, done by hand from
the release page. Verified on a real machine: `%LOCALAPPDATA%\sapho-updater\`
contains `installer.exe`.

**3. `package.json` `name` is load-bearing for the updater cache.**
`updaterCacheDirName` is `sanitizeFileName(metadata.name).toLowerCase() + "-updater"`
— today `sapho` → `%LOCALAPPDATA%\sapho-updater`. Rename the package and every
installed copy looks for its delta base in a directory that does not exist:
no error, no warning, just a silent fall back to a full ~500 MB download for
the whole fleet. (A machine here still carries an `aurora-ide-updater` folder
from before the April 2026 rename — that is what the leftover looks like.)
**Do not rename it.**

**Corollary for release planning:** a release that bumps the toolchain changes
most of the payload, so its delta is close to a full download. App-only
releases are cheap. When both are pending and the fleet is on a metered or
slow link, cut them as separate releases rather than one — the toolchain bump
costs the full download either way, but the app fix reaches everyone quickly.

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
