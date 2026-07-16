<p align="center">
  <img src="assets/icons/aurora_borealis_final.svg" alt="AURORA" width="160">
</p>

<h1 align="center">AURORA IDE</h1>

<p align="center">
  <em>The integrated development environment for the SAPHO platform.</em>
</p>

<p align="center">
  <a href="https://github.com/nipscernlab/sapho/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/nipscernlab/sapho?style=flat-square"></a>
  <a href="https://github.com/nipscernlab/aurora/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/nipscernlab/aurora/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://codecov.io/gh/nipscernlab/aurora"><img alt="Coverage" src="https://img.shields.io/codecov/c/github/nipscernlab/aurora/main?style=flat-square"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-windows-lightgrey?style=flat-square">
  <img alt="Built with Electron" src="https://img.shields.io/badge/electron-39-47848F?style=flat-square&logo=electron&logoColor=white">
</p>

---

AURORA is a desktop IDE that unifies every step of the **SAPHO** hardware-design
workflow — writing C±, assembling, synthesising Verilog, simulating with Icarus
Verilog, viewing waveforms in GTKWave, and inspecting RTL with PRISM — behind
one consistent interface built on Electron and Monaco.

AURORA is developed by [NIPS-CERN](https://www.nipscern.com), a research group at
the [Universidade Federal de Juiz de Fora](https://www.ufjf.br) (UFJF) in Brazil,
working in collaboration with CERN.
Project page: [nipscern.com/projects/aurora](https://www.nipscern.com/projects/aurora).

## Screenshots

<!--
  TODO(maintainers): drop real assets into docs/media/ and uncomment.
  See docs/media/README.md for the recommended shot list (hero + GIFs).

  <p align="center"><img src="docs/media/hero.png" alt="AURORA editor" width="900"></p>

  | Split editor | Compilation | PRISM / waveform |
  |---|---|---|
  | ![split](docs/media/split-editor.gif) | ![compile](docs/media/compile.gif) | ![prism](docs/media/prism.gif) |
-->

> Screenshots and demo GIFs are pending — see [docs/media/](docs/media/) for the shot list.

## Features

- **Project- and processor-oriented workspaces** with a unified file tree,
  per-processor colour coding, and a dedicated Verilog file mode.
- **Three compilation targets** — single processor, full project, and
  Verilog-only synthesis — each routed through the same toolchain (CMM →
  ASM → Icarus Verilog → GTKWave).
- **Split editor** with up to three panes that share a Monaco model: edits
  in any pane propagate live to every other pane showing the same file.
- **PRISM RTL viewer** powered by Yosys + netlistsvg for live netlist
  inspection.
- **Hierarchical tree** generated post-synthesis, swappable with the
  filesystem tree from a single toggle.
- **Project backups** (zipped on demand) and a **recent-projects welcome
  screen** in the style of VS Code.
- **Auto-updates** delivered through GitHub Releases via electron-updater.

## Getting started

### Install (recommended for end users)

Stable installers ship from the **SAPHO** distribution repo (the suite =
YANC + AURORA). Download the latest from the
[SAPHO Releases page](https://github.com/nipscernlab/sapho/releases/latest)
and run `sapho-aurora-Setup-vX.Y.Z.exe`.

> **Two repos, on purpose.** `nipscernlab/aurora` is where the GUI is
> *developed* (this repo); `nipscernlab/sapho` is the *release channel*
> end users download. See [CONTRIBUTING.md](CONTRIBUTING.md) for the split.

### Build from source (Windows 10/11)

Follow the steps below in order. Steps 1–4 are required; step 5 is only
needed if you want to produce a redistributable installer.

#### 1. Install Node.js 18+ (and Git)

The easiest way on Windows is via `winget` from any PowerShell window:

```powershell
winget install --id OpenJS.NodeJS.LTS  -e --source winget
winget install --id Git.Git            -e --source winget
```

Close and reopen PowerShell so the new `node`, `npm`, and `git` are on
your `PATH`, then verify:

```powershell
node --version    # must be v18.0.0 or newer
npm  --version
git  --version
```

> Prefer a GUI? Grab the LTS installer from
> <https://nodejs.org/en/download> and Git from
> <https://git-scm.com/download/win>.

#### 2. Clone the repository

```powershell
git clone https://github.com/nipscernlab/aurora.git
cd aurora
```

#### 3. Install npm dependencies

```powershell
npm install
```

This pulls Electron, Monaco, electron-builder and the rest of the
JavaScript stack listed in [`package.json`](package.json) into
`node_modules/`.

#### 4. Launch AURORA

```powershell
npm start
```

The first run does a bit more than just `electron .`: the `prestart`
hook runs [`npm run bootstrap`](package.json), which in turn:

1. Verifies the exact-pinned versions in `node_modules/` match
   `package.json`
   ([`scripts/check-pinned-versions.js`](scripts/check-pinned-versions.js)).
2. Downloads the SAPHO **toolchain bundle** (Icarus Verilog, GTKWave,
   Yosys, netlistsvg, 7-Zip) from the `toolchain-v2` GitHub Release and
   extracts it into `components/Packages/`
   ([`components/Scripts/download-toolchain.js`](components/Scripts/download-toolchain.js)).
3. Downloads the **YANC compilers** (`cmmcomp.exe`, `asmcomp.exe`,
   `appcomp.exe`, `comp2gtkw.exe` + HDL libs + macros) from
   [`nipscernlab/yanc`](https://github.com/nipscernlab/yanc) and
   extracts them into `components/bin/`
   ([`components/Scripts/download-yanc.js`](components/Scripts/download-yanc.js)).
4. Mirrors `components/` into `node_modules/electron/dist/components`
   so the bundled toolchain is reachable from the running app
   ([`components/Scripts/copy-components.js`](components/Scripts/copy-components.js)).

Both downloads are idempotent — they skip if the binaries are already
present. To force a re-download (after the release tag bumps, for
example):

```powershell
node components/Scripts/download-toolchain.js --force
node components/Scripts/download-yanc.js      --force
```

If you are offline or behind a corporate proxy and the downloads fail,
each script prints the direct URL it tried; download the ZIP in a
browser and extract it manually:

* `aurora-msys-v1.zip` → extract **into** `components/Packages/`
  (so you end up with `components/Packages/msys/mingw64/bin/iverilog.exe`).
* `yanc-bin-v5.2.zip` → extract **into** `components/`
  (so you end up with `components/bin/cmmcomp.exe`).

#### 5. Build a distributable installer (optional)

```powershell
npm run build
```

The `prebuild` hook re-runs `npm run bootstrap`, then
`electron-builder` packages everything into `dist/`:

```
dist/
├── sapho-aurora-Setup-v5.0.0.exe          # the NSIS installer
├── sapho-aurora-Setup-v5.0.0.exe.blockmap # delta-update map
└── latest.yml                             # auto-updater manifest
```

> **Note** — AURORA bundles a Windows-only toolchain (Icarus Verilog,
> GTKWave, Yosys, netlistsvg). It is not currently supported on macOS or
> Linux.

### Syncing the language rules (maintainer only)

The Aurora Intelligence panel and editor introspection consume a static
[`resources/sapho_rules.json`](resources/sapho_rules.json) capturing the
CMM language surface — keywords, hardware directives, bilingual error
catalog, grammar skeleton — extracted from the
[`yanc`](https://github.com/nipscernlab/yanc) source tree. yanc itself
is **not** bundled with the installer, so the JSON has to be regenerated
on a maintainer machine whenever yanc changes:

```powershell
npm run rules:sync
```

By default the script reads from `C:\Users\LCOM\Documents\Github\yanc`.
Override the location with the `YANC_PATH` env var or the `--yanc` flag:

```powershell
$env:YANC_PATH = 'D:\path\to\yanc'
npm run rules:sync

# or
node scripts/sync-sapho-rules.js --yanc D:\path\to\yanc
```

The script writes a summary to stdout — keyword / directive / message
counts plus the yanc commit hash. Commit the regenerated
`resources/sapho_rules.json` so CI never has to reach yanc directly.

## SAPHO toolchain

AURORA orchestrates these tools, all driven from the toolbar's compile group:

| Step  | Button     | Backing tool        | Notes |
|-------|------------|---------------------|-------|
| C±    | `cmmcomp`  | cmmcomp + asmcomp   | Per-processor; runs CMM then ASM |
| Veri  | `vericomp` | Icarus Verilog      | Synthesises top-level |
| Wave  | `wavecomp` | GTKWave             | Opens generated .vcd/.fst |
| PRISM | `prismcomp`| Yosys + netlistsvg  | RTL viewer |

The mode toggle (`Processor` / `Project`) and the Compile-&-Simulate switch
together pick the pipeline:

- **Processor** — single active processor, full CMM → ASM → IVL → Wave loop.
- **Project + Simulate** — every processor in the `.spf`, then
  testbench-driven simulation.
- **Project + Compile only** — Verilog-only synthesis; no CMM/ASM steps.

## Releasing

Releases produce two GitHub artefacts: the **app installer** that end
users download and the **toolchain bundle** the build pipeline depends
on. Both flow through GitHub Releases so the auto-updater
([`main/updater.js`](main/updater.js)) and the CI workflow
([`.github/workflows/release.yml`](.github/workflows/release.yml)) can
read them directly.

### One-time setup — toolchain bundle

The bundled SAPHO toolchain (Icarus Verilog, GTKWave, Yosys,
netlistsvg, 7-Zip) lives in its own GitHub Release rather than in the
source tree. Cut a new toolchain release whenever any of those binaries
changes.

```powershell
# From a checkout that has components/Packages/ populated locally
$ver = "v2"
Compress-Archive -Path components/Packages/* `
                 -DestinationPath ..\aurora-toolchain-$ver.zip `
                 -CompressionLevel Optimal -Force
```

Then in the browser:

1. Open <https://github.com/nipscernlab/aurora/releases/new>
2. **Choose a tag:** type `toolchain-v2` → *Create new tag on publish*
3. **Title:** `AURORA toolchain v2`
4. **Description:** one-liner about which upstream versions are bundled
5. Tick **Set as a pre-release** (so it doesn't appear as the
   user-facing "latest")
6. Drag-and-drop `..\aurora-toolchain-v2.zip` into the assets area
7. Click **Publish release**

This is the bundle the release workflow downloads on every build.

### Cutting an app release

#### Recommended — release-please

Every push to `main` triggers
[`.github/workflows/release-please.yml`](.github/workflows/release-please.yml),
which keeps a permanent **"release PR"** open. That PR aggregates every
[Conventional Commit](https://www.conventionalcommits.org/) since the
last release, bumps `package.json` + the manifest, and updates
`CHANGELOG.md` with auto-generated notes. To ship:

1. Review the open release PR (`chore(main): release X.Y.Z`).
2. Merge it. release-please creates the `vX.Y.Z` tag and the GitHub
   Release immediately.
3. Open the **Actions** tab → **Release** workflow → **Run workflow**,
   passing the toolchain tag (e.g. `toolchain-v2`). The job builds the
   installer with `electron-builder --publish always` and uploads
   `sapho-aurora-Setup-vX.Y.Z.exe`, the matching `.blockmap`, and
   `latest.yml` onto the release the bot just created. The auto-updater
   takes it from there.

Commit prefixes drive the version bump:
- `feat:` → minor (or patch while < 1.0)
- `fix:` / `perf:` / `refactor:` → patch
- Any commit body containing `BREAKING CHANGE:` → major

#### Manual fallback

```powershell
npm version patch          # or `minor` / `major` — creates a tagged commit
git push --follow-tags
```

Then either:

* **CI build:** open the **Actions** tab → **Release** workflow → **Run
  workflow**. Pass the toolchain release tag (e.g. `toolchain-v2`). The
  workflow downloads the toolchain, runs `electron-builder --publish
  always`, and the auto-updater takes it from there.
* **Manual (local build):** run `npm run build`, then upload the three
  files from `dist/` (the `.exe`, the `.exe.blockmap`, and `latest.yml`)
  to a new GitHub Release at the matching tag.

### Manual upload (the v5.0.0 way)

If CI isn't an option, build locally and upload through the browser:

1. `npm run build` — produces `dist/sapho-aurora-Setup-vX.Y.Z.exe`,
   `dist/sapho-aurora-Setup-vX.Y.Z.exe.blockmap`, and `dist/latest.yml`.
2. Open <https://github.com/nipscernlab/sapho/releases/new> (app releases ship from the SAPHO channel)
3. **Choose a tag:** select the existing `vX.Y.Z` tag (or create one)
4. **Title:** `AURORA IDE vX.Y.Z`
5. **Description:** copy the relevant section from
   [`CHANGELOG.md`](CHANGELOG.md)
6. Drag-and-drop **all three** files from `dist/` into the assets area
7. Tick **Set as the latest release**
8. Click **Publish release**

The moment the release is published, every user running an older AURORA
sees the update prompt within ~10 s of launching — that's
[`updater.js#initializeUpdateSystem`](main/updater.js#L208) firing the
silent startup check.

### How the auto-updater works

| Stage                | Behaviour                                                     |
|----------------------|---------------------------------------------------------------|
| Boot + 10 s          | Silent check; no dialog if up to date                         |
| Update available     | Native dialog with version + download size + release notes    |
| Download             | Progress window driven by IPC channel `update-progress`       |
| Download finished    | Native "Install Now / Install Later" dialog → `quitAndInstall`|
| Renderer-driven check| `electronAPI.checkForUpdates()` — interactive, with a no-update toast |
| Renderer-driven start| `electronAPI.downloadUpdate()` once an update is known         |
| Renderer-driven install| `electronAPI.quitAndInstall()` once the download finished    |

Feed URL is hardwired to
`github://nipscernlab/aurora` (release channel) in
[`updater.js#initializeUpdateSystem`](main/updater.js#L208). The
installer's filename embeds `${version}` so `latest.yml` always points
at the right artefact.

## Logs

When filing a bug, attaching `main.log` makes diagnosis trivial.
electron-log writes it to the platform-standard user data directory:

| OS      | Path                                            |
|---------|-------------------------------------------------|
| Windows | `%APPDATA%\Aurora-IDE\logs\main.log`            |
| macOS   | `~/Library/Logs/Aurora-IDE/main.log`            |
| Linux   | `~/.config/Aurora-IDE/logs/main.log`            |

The file rolls over at ~5 MB (older content moves to `main.old.log`).
Default level is `info`; flip to `debug` in
[`main/logger.js`](main/logger.js) when chasing a specific issue.

## Contributing

We welcome bug reports, feature requests, and pull requests. Please read
[`CONTRIBUTING.md`](CONTRIBUTING.md) before opening an issue or PR, and the
[Contributor Covenant](CODE_OF_CONDUCT.md) for our community standards.

## Security

If you have discovered a security issue, **do not open a public issue**.
Please follow the disclosure process described in
[`SECURITY.md`](SECURITY.md).

## License

AURORA is released under the [MIT License](LICENSE). Bundled third-party
toolchain components retain their original licences (GPL, ISC, MIT) — see
the LICENSE file for the full attribution list.

## About NIPS-CERN

AURORA is developed and maintained by **NIPS-CERN**, the research and development
group of the Department of Electrical Engineering at the
[Universidade Federal de Juiz de Fora](https://www.ufjf.br) (UFJF), Brazil.

NIPS-CERN operates two laboratories: one at CERN in Geneva, Switzerland, and one
in the PPEE (Graduate Program in Electrical Engineering) building at UFJF. Students
and researchers work at both. UFJF's Department of Electrical Engineering is a
[member institution of the ATLAS Collaboration](https://atlaspo.cern.ch/public/institutions/)
at CERN, with system membership in the Tile Calorimeter and the Liquid-Argon
Calorimeter.

| | |
|---|---|
| Institutional website | [nipscern.com](https://www.nipscern.com) |
| About the group | [nipscern.com/about](https://www.nipscern.com/about) |
| University | [Universidade Federal de Juiz de Fora (UFJF)](https://www.ufjf.br) |
| SAPHO project page | [nipscern.com/projects/sapho](https://www.nipscern.com/projects/sapho) |
| AURORA project page | [nipscern.com/projects/aurora](https://www.nipscern.com/projects/aurora) |
| Publications | [nipscern.com/publications](https://www.nipscern.com/publications) |
| Contact | contact@nipscern.com |

### Citing SAPHO

The SAPHO architecture is described in:

> SAPHO, Scalable-Architecture Processor for Hardware Optimization: An FPGA
> Customizable Implementation Approach. *IEEE*, 2026.
> <https://ieeexplore.ieee.org/document/11345120/>

Further publications on SAPHO, AURORA and YANC, including applications in
high-energy physics instrumentation, are listed at
[nipscern.com/publications](https://www.nipscern.com/publications).

## Acknowledgements

AURORA builds on work from the open-source EDA community, in particular Icarus
Verilog, GTKWave, Yosys, netlistsvg, Monaco, and Electron.
