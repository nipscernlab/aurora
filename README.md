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
