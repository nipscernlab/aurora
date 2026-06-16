# Changelog

All notable changes to this project are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely follows [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added
- LICENSE (MIT) with a third-party attributions section.
- Refreshed README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- `.editorconfig`, `.gitattributes`, `.github/` workflows and templates.
- `js/editor/shared_models.js`: reference-counted Monaco model registry
  so split panes of the same file edit, undo, and save in sync.
- `SplitEditorManager.getFocusedFile()` and `TabManager.getEditingFilePath()`
  so Ctrl+S saves whichever pane has focus.
- `aurora-editor-focused` event: cursor in any editor now activates the
  corresponding tab automatically.
- `RELEASE.md`: bootstrap process for end users; toolchain binaries no
  longer live in the source tree.
- Surfer waveform viewer — curated `.surf.ron` layout now decodes the
  Assembly (`valr2`) and source-line (`linetabs`) instruction tracks via
  Surfer mapping translators (built from the YANC `trad_opcode.txt` /
  `trad_cmm.txt`), and decodes complex numbers (`comp_me3_*` /
  `comp_arr_me3_*`) through a `comp2gtkw.exe` pre-pass. Instruction tracks
  are always shown whenever a processor is present.
- Surfer layout — per-processor labels on the Assembly/C+- tracks (e.g.
  `Assembly (cnn_features)`), red-coloured section dividers (kept italic),
  and a real collapsible `Group` per processor so multi-processor designs
  fold cleanly. Per-processor instruction labels also applied to GTKWave.
- Surfer quick-wins — each section (I/O, Instructions, Variables, Flags,
  arrays, Stack/ULA) is now a nested collapsible group (arrays/Flags closed
  by default); the complex-decode path pre-checks `comp2gtkw.exe`/`fst2vcd.exe`
  and warns once in the terminal instead of degrading to raw binary silently;
  re-simulating reuses a single Surfer window (the previous one is closed
  before the new launch) instead of stacking windows; and the launch terminal
  messages now say "Surfer" instead of "GTKWave". (Surfer's own file-watch
  auto-reload does not fire on Windows v0.7.0, so it is not used.)
- Surfer is now bundled in the installer — `download-surfer.js` fetches
  `surfer.exe` v0.7.0 during bootstrap (the `extraResources` step ships it),
  so the Surfer viewer works out of the box instead of falling back to GTKWave.
  Listed under EUPL-1.2 in the third-party attributions.
- Surfer: a "keep windows open to compare runs" toggle in the Wave Configuration
  modal — off by default (one window, the previous is closed on each launch),
  on to keep multiple Surfer windows for side-by-side comparison.
- Surfer: user float variables (`me2_`/`arr_me2_`) render as an analog curve
  (Step, global Y-scale) instead of raw numbers — readable over long traces,
  exact value still shown at the cursor; clk/rst/itr render at half height.
- Surfer mapping robustness — translator files are now namespaced per project
  (FNV-1a tag of the project path) so two open projects with the same testbench
  top no longer overwrite each other in the shared global mappings dir; written
  atomically (temp + rename) so the viewer never reads a half-written file; and
  the renderer warns when the decode tables are newer than the dump (recompiled
  without re-simulating → the Assembly/source decode would be stale).

### Changed
- All file trees (standard, hierarchy, Verilog) now share a single
  typography — same row height, font size, weight, and colour.
- Project loading now seeds `window.availableProcessors` from the SPF
  payload so processor folders get their per-processor colour on the
  first paint, not after the user opens Settings.
- Per-processor colour assignment is positional (16 distinct slots,
  wrapping after 16) instead of hash-based.
- Backups produce a real `.zip` via PowerShell `Compress-Archive` and
  always clean up the staging folder, even on failure.
- Verilog-only GTKWave run now stages `fix.vcd` and uses
  `gtk_almost_proj.tcl` so the fix tab opens like in the other modes.
- Pen (`vericomp`) and square-wave (`wavecomp`) icons redrawn in toolbar
  and terminal tabs.

### Fixed
- Collapse-All actually collapses (the previous handler only refreshed
  because `FileTreeState` wasn't exported).
- "No project open" label no longer sticks after a successful auto-load
  with sparse `.spf` metadata.
