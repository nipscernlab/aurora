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
| Surfer — fork NIPSCERN [`surfer-aurora`](https://gitlab.com/nips-cern/surfer-aurora), derivado de [surfer-project/surfer](https://gitlab.com/surfer-project/surfer) | Waveform viewer (Rust) | EUPL-1.2 (fork publico) |
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
| `katex` | ^0.18 | MIT |
| `lit` | ^3.3 | BSD-3-Clause |
| `@phosphor-icons/web` | ^2.1 | MIT |
| `@silimate/netlistsvg` (nipscern fork) | git | MIT |
| `ai` + `@ai-sdk/*` (Anthropic/OpenAI/Google/Groq/DeepSeek) | ^7 / ^4 | Apache-2.0 |
| `@modelcontextprotocol/sdk` | ^1.29 | MIT |
| `chokidar` | ^5 | MIT |
| `electron-log` | ^5.4 | MIT |
| `electron-updater` | ^6.8 | MIT |
| `fs-extra` | ^11.4 | MIT |
| `zod` | ^4.4 | MIT |
| Electron | ^43 | MIT |

## Fonts

| Font | License |
|---|---|
| Inter | SIL Open Font License 1.1 |
| JetBrains Mono | SIL Open Font License 1.1 |
| Metamorphous, by James Grieshaber (the "Dagr" wordmark) | SIL Open Font License 1.1 |
| Noto Sans Runic, by Google (the Dagaz rune) | SIL Open Font License 1.1 |

---

Distributions of SAPHO/AURORA that include these tools must comply with the terms
of their respective licenses. The GPL-licensed components (Icarus Verilog,
GTKWave) and the EUPL-licensed Surfer are invoked as separate, arm's-length
processes, so AURORA does not link against them, and the LGPL components are used
unmodified. Their licenses still accompany the distribution as required.

**Closed on 2026-08-08: the Dagr wordmark font.** Until that date this file
said the Norse font by Joël Carrouché was "not redistributed". That was checked
and it was not accurate. Vite copied the font into `dist/assets/` and
electron-builder does not exclude `assets/`, so the published installer carried
the file. Keeping a font out of the git repository is not the same as keeping it
out of the distribution, and the Norse license forbids redistribution.

The wordmark now uses Metamorphous for the Latin letters and Noto Sans Runic for
the Dagaz rune, both under the SIL Open Font License 1.1, which permits
redistribution and embedding. They are fetched by `scripts/fetch-fonts.js` and
committed alongside Inter and JetBrains Mono, so there is no bootstrap download
and nothing to keep out of the repository.
