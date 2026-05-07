<p align="center">
  <img src="assets/icons/aurora_borealis_final.svg" alt="AURORA" width="160">
</p>

<h1 align="center">AURORA IDE</h1>

<p align="center">
  <em>The integrated development environment for the SAPHO platform.</em>
</p>

<p align="center">
  <a href="https://github.com/nipscernlab/Aurora/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/nipscernlab/Aurora?style=flat-square"></a>
  <a href="https://github.com/nipscernlab/Aurora/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/nipscernlab/Aurora/ci.yml?branch=main&style=flat-square"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-windows-lightgrey?style=flat-square">
  <img alt="Built with Electron" src="https://img.shields.io/badge/electron-38-47848F?style=flat-square&logo=electron&logoColor=white">
</p>

---

AURORA is a desktop IDE that unifies every step of the **SAPHO** hardware-design
workflow — writing C±, assembling, synthesising Verilog, simulating with Icarus
Verilog, viewing waveforms in GTKWave, and inspecting RTL with PRISM — behind
one consistent interface built on Electron and Monaco.

## Features

- **Project- and processor-oriented workspaces** with a unified file tree,
  per-processor colour coding, and a dedicated Verilog file mode.
- **Three compilation targets** — single processor, full project, and
  Verilog-only synthesis — each routed through the same toolchain (CMM →
  ASM → Icarus Verilog → GTKWave) with `fix.vcd` always loaded alongside.
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

Download the latest installer from the
[Releases page](https://github.com/nipscernlab/Aurora/releases/latest)
and run `AuroraIDE-Setup-vX.Y.Z.exe`.

### Build from source (Windows 10/11)

Prerequisites:

| Tool       | Version |
|------------|---------|
| Node.js    | 18 LTS or newer |
| npm        | bundled with Node |
| PowerShell | 5.1+ (used for native zip backups) |

```powershell
git clone https://github.com/nipscernlab/Aurora.git
cd Aurora
npm install
npm start          # launch in development
npm run build      # produce an installer in dist/
```

> **Note** — AURORA bundles a Windows-only toolchain (Icarus Verilog,
> GTKWave, Yosys, netlistsvg). It is not currently supported on macOS or
> Linux.

### Project layout

```
aurora/
├── assets/          Icons, audio, branding
├── components/      Bundled toolchain (iverilog, gtkwave, yosys, prism, …)
├── css/             Stylesheets, organised by area
│   ├── base/        Theme variables, layout, reset
│   ├── editor/      Monaco wrapper, tabs
│   ├── modals/      Dialogs and welcome screen
│   ├── panels/      Side panels (AI, processor hub, settings)
│   ├── shell/       Toolbar, status bar
│   └── tree/        Standard / hierarchy / Verilog file trees
├── html/            Auxiliary HTML pages (settings, progress)
├── js/              Renderer-side modules
│   ├── app/         Bootstrapping, preload, renderer entry
│   ├── compilation/ CMM/ASM/Verilog/Wave pipelines
│   ├── editor/      Monaco editor, split editor, shared models
│   ├── processors/  Processor hub UI
│   ├── project/     Open/close, recents, project & file modes
│   ├── services/    AI assistant, file import
│   ├── tabs/        Tab manager + viewers
│   ├── terminal/    Terminal output, VVP progress
│   ├── tree/        File-tree manager + togglers
│   ├── ui/          Dialogs, palettes, notifications, tooltips
│   └── utils/       Shortcuts, zoom, resize
├── main/            Electron main process + IPC handlers
├── index.html
├── main.js
└── package.json
```

## SAPHO toolchain

AURORA orchestrates these tools, all driven from the toolbar's compile group:

| Step  | Button     | Backing tool        | Notes |
|-------|------------|---------------------|-------|
| C±    | `cmmcomp`  | SAPHO CMM compiler  | Per-processor |
| ASM   | `asmcomp`  | SAPHO assembler     | Per-processor |
| Veri  | `vericomp` | Icarus Verilog      | Synthesises top-level |
| Wave  | `wavecomp` | GTKWave             | Always opens `fix.vcd` |
| PRISM | `prismcomp`| Yosys + netlistsvg  | RTL viewer |

The mode toggle (`Processor` / `Project`) and the Compile-&-Simulate switch
together pick the pipeline:

- **Processor** — single active processor, full CMM → ASM → IVL → Wave loop.
- **Project + Simulate** — every processor in `projectOriented.json`, then
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

1. Open <https://github.com/nipscernlab/Aurora/releases/new>
2. **Choose a tag:** type `toolchain-v2` → *Create new tag on publish*
3. **Title:** `AURORA toolchain v2`
4. **Description:** one-liner about which upstream versions are bundled
5. ✅ Tick **Set as a pre-release** (so it doesn't appear as the
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
   `AuroraIDE-Setup-vX.Y.Z.exe`, the matching `.blockmap`, and
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

### Manual upload (the v4.1.13 way)

If CI isn't an option, build locally and upload through the browser:

1. `npm run build` — produces `dist/AuroraIDE-Setup-vX.Y.Z.exe`,
   `dist/AuroraIDE-Setup-vX.Y.Z.exe.blockmap`, and `dist/latest.yml`.
2. Open <https://github.com/nipscernlab/Aurora/releases/new>
3. **Choose a tag:** select the existing `vX.Y.Z` tag (or create one)
4. **Title:** `AURORA IDE vX.Y.Z`
5. **Description:** copy the relevant section from
   [`CHANGELOG.md`](CHANGELOG.md)
6. Drag-and-drop **all three** files from `dist/` into the assets area
7. ✅ Tick **Set as the latest release**
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

## Acknowledgements

AURORA is developed and maintained by **NIPSCERN** at the
[Universidade Federal de Juiz de Fora](https://www.ufjf.br). It builds on
work from the open-source EDA community — in particular Icarus Verilog,
GTKWave, Yosys, netlistsvg, Monaco, and Electron.
