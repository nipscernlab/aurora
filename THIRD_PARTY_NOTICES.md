# Third-Party Notices

SAPHO / AURORA bundles, downloads at bootstrap, or links against the third-party
software listed below. Each component remains under its own license; those
licenses apply to their respective files in addition to AURORA's own
[LICENSE](LICENSE) (MIT). Full license texts are available from each project's
upstream repository.

This file is generated/maintained from `package.json` and the toolchain download
manifests (`components/Scripts/download-*.js`). When you add or bump a bundled
component, update this list.

## Hardware toolchain (downloaded at bootstrap into `components/`)

These native binaries are fetched by the bootstrap step (`components/Scripts/download-*.js`)
and shipped in the installer; they are not part of the source tree.

| Component | Purpose | License |
|---|---|---|
| Icarus Verilog (`iverilog`/`vvp`) | Verilog compilation + simulation | GNU GPL v2 |
| GTKWave (nipscern fork) | Waveform viewer + `fst2vcd`/`vcd2fst` | GNU GPL v2 |
| Surfer | Waveform viewer (Rust) | EUPL-1.2 |
| Yosys (+ ABC) | RTL synthesis (PRISM) | ISC (Yosys) · MIT-style (ABC, UC Berkeley) |
| Verilator | Fast Verilog simulation | LGPL-3.0 or Artistic-2.0 |
| Python + cocotb | Cocotb test flow | PSF (Python) · BSD-3-Clause (cocotb) |
| MSYS2 / MinGW runtime | Hosts the GTK/Yosys binaries on Windows | various (GPL/LGPL/MIT per package) |
| comp2gtkw (YANC) | Complex-number decode for waveforms | per the YANC project |

## AI command-line tools (bundled via npm)

| Package | License |
|---|---|
| `@anthropic-ai/claude-code` | Anthropic Commercial Terms of Service |
| `@openai/codex` | OpenAI terms / Apache-2.0 (per the published package) |

## Runtime libraries (npm)

| Package | Version | License |
|---|---|---|
| `monaco-editor` | 0.52.2 | MIT |
| `katex` | ^0.17 | MIT |
| `lit` | ^3.3 | BSD-3-Clause |
| `@phosphor-icons/web` | ^2.1 | MIT |
| `@silimate/netlistsvg` (nipscern fork) | git | MIT |
| `ai` + `@ai-sdk/*` (Anthropic/OpenAI/Google/Groq/DeepSeek) | ^6 / ^3 | Apache-2.0 |
| `@modelcontextprotocol/sdk` | ^1.29 | MIT |
| `chokidar` | ^4 | MIT |
| `electron-log` | ^5.4 | MIT |
| `electron-updater` | ^6.6 | MIT |
| `fs-extra` | ^11.3 | MIT |
| `zod` | ^3.25 | MIT |
| Electron | ^39 | MIT |

## Fonts

| Font | License |
|---|---|
| Inter | SIL Open Font License 1.1 |
| JetBrains Mono | SIL Open Font License 1.1 |

---

Distributions of SAPHO/AURORA that include these tools must comply with the terms
of their respective licenses. The GPL-licensed components (Icarus Verilog,
GTKWave) and the EUPL-licensed Surfer are invoked as separate, arm's-length
processes — AURORA does not link against them — and the LGPL components are used
unmodified; their licenses still accompany the distribution as required.
