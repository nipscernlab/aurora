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
