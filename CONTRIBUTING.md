# Contributing to AURORA

Thank you for considering it. The IDE benefits from every well-formed bug report,
design discussion and pull request, small fixes included. This document is
deliberately short: if you have worked on a Node or Electron project before,
nothing here will surprise you.

By participating you agree to the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Reporting bugs

Open an issue with the Bug report template. Say what you did, ideally as steps
from a fresh project, what you expected, and what actually happened. Screenshots
and the relevant terminal output help; the terminals are named TCMM, TASM, TVERI,
TWAVE, THTEST and TCMD. Include your AURORA version, from Settings then About,
your Windows build, and your Node version if you build from source.

If the bug touches the toolchain, Icarus Verilog, Verilator, GTKWave, Surfer or
Yosys, include the exact command AURORA logged. That is usually enough to
reproduce the problem outside the IDE, which makes it much easier to fix.

Attaching `main.log` makes diagnosis far easier. Settings, About, Updates, Open
log reveals the file; the README explains where it lives.

## Suggesting features

Open an issue with the Feature request template. The most useful proposals
describe the user problem you are trying to solve, the workflow you would want
instead, and any constraints you know about. Implementation sketches are welcome
but not required.

## Pull requests

Fork, branch from `main`, and keep one logical change per pull request. Run
`npm install` and `npm start` first to confirm the IDE still launches on your
machine.

Match the surrounding code. Indentation follows `.editorconfig`, which is four
spaces under `js/` and two under `main/`. Comment the why, not the what; the
repository convention is to omit comments that restate the code and to write down
the reason a non-obvious decision was made.

There is no `npm run lint` script. Lint with `npx eslint .`, which is what CI
runs, and fix warnings in the files you touched rather than reformatting
unrelated code in the same change.

If you touch a renderer module that takes part in the editor or the compilation
flow, read [ARCHITECTURE.md](ARCHITECTURE.md) first. It lists contracts that break
silently, and its final section is a checklist worth walking through before you
open the pull request. Then smoke-test by hand: open a project, split the editor,
edit, save, and run each compile button.

Open the pull request against `main`, fill in the template, and reference related
issues with `Fixes #123`.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/). This is not
cosmetic here: release-please reads the commit history to decide the next version
and to write the changelog, so a mislabelled commit produces a wrong release.

```
feat(tree): per-processor colors, unified icons, hierarchy fixes
fix(split): give each pane its own Monaco model
refactor(tabs): split TabManager into core + viewer/drag/watcher mixins
```

Allowed types are `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`,
`build`, `ci` and `perf`. A `feat` bumps the minor version, a `fix`, `perf` or
`refactor` bumps the patch, and a body containing `BREAKING CHANGE:` bumps the
major.

### Tests

`npm test` runs the unit suite, which is fast and needs nothing installed.
`npm run test:e2e` launches a real AURORA through Playwright and asserts that
Monaco initialises without the failure modes that have bitten before.

`npm run test:toolchain` is the one that matters most for compile changes. It
drives the real binaries: a C± source becomes a Verilog processor, elaborates,
simulates under Icarus, Verilator and cocotb, synthesises to a PRISM schematic,
and the language servers answer a handshake. It builds every command with the
same builders the application uses, so a changed flag fails there instead of in a
teaching lab. It is not part of `npm test` because it needs the full `components`
tree, about a gigabyte, and it skips with a message naming the missing binaries
when the toolchain is absent.

## For maintainers

### The toolchain is not in the source tree

The repository does not ship the SAPHO toolchain. Those binaries live in GitHub
releases and arrive through `npm run bootstrap`, which is what keeps a clone at a
few megabytes instead of about a gigabyte.

We did commit them once. The git history reached roughly 550 MiB against about
7 MiB of actual source, because every replacement of `yosys.exe`, `gtkwave.exe`
and friends added another fifty-megabyte blob to the pack. GitHub's hard limit
for a single file is 100 MiB and the soft limit for a repository is 1 GiB, so
continuing would have crossed both within a few releases and made cloning painful
for contributors.

### Checking and repairing an installation

`npm run components:verify` is the doctor. It reports which components are
present, which are missing, and which have drifted from the pinned tag, and it
can re-run the individual download scripts to repair. It also runs automatically
after `npm install`, which is how a version bump in a component gets noticed.

### Cutting a release

Every push to `main` keeps a release pull request open, aggregating the
conventional commits since the last release and preparing the version bump and
the changelog. Merging that pull request creates the tag and the GitHub release.

Building and publishing the installer follows from that same merge: the release
workflow chains into the build, which produces the Windows installer and uploads
it along with `latest.yml` and the blockmap. It can also be triggered by hand,
which is how a failed publish is retried. Releases publish to
`nipscernlab/sapho`, which is the distribution channel; this repository is where
development happens. The updater reads the same place, so the two cannot
disagree.

The toolchain bundle lives in its own pre-release rather than in the source tree,
and only needs a new one when the bundled binaries actually change.

### Differential updates, and three ways to break them

The installer is around 140 MB, and it does not carry the toolchain. It was
around 500 MB through 6.6.1; 6.7.0 halved it by moving the bundled binaries out,
and 6.8.0 reached today's size by fixing three packaging mistakes that were
inflating the asar. The toolchain now arrives on demand into
`%LOCALAPPDATA%\SAPHO\components`, roughly a gigabyte that the installer never
carries and that an update leaves untouched. Even the 140 MB is a one-time cost
per machine rather than a per-update cost, because electron-updater fetches only
the changed blocks. Three things make that work and each is easy to break by
accident.

The blockmap is already tuned, so do not try to improve the compression.
electron-builder forces normal compression, non-solid, with a one-megabyte
dictionary for any differential-aware NSIS package, and its own source comment
explains why: allowing the compression level to change would produce different
packages. Setting maximum compression in `package.json` is therefore ignored for
the inner archive and buys nothing. Solid compression would be actively harmful,
because one changed byte early in a solid stream invalidates every block after it.

The delta base is the previous installer, cached locally. The updater looks for
`installer.exe` in its cache directory and diffs against it, and never
re-downloads the old installer. That file is written by the NSIS installer
itself, so every install seeds it, including the very first one done by hand from
the release page.

The `name` field in `package.json` is load-bearing, because the updater cache
directory derives from it. Rename the package and every installed copy looks for
its delta base in a directory that does not exist: no error, no warning, just a
silent fall back to a full download for the whole fleet.
[ARCHITECTURE.md](ARCHITECTURE.md) has the full identity table, covering the four
name fields and what each one moves on disk.

One consequence for planning: a release that bumps the toolchain changes most of
the payload, so its delta is close to a full download, while an application-only
release is cheap. When both are pending and the machines are on a slow link, cut
them as two releases rather than one. The toolchain bump costs the full download
either way, and the application fix reaches everyone quickly.

## Questions

For anything that is not a bug report or a feature request, open a
[Discussion](https://github.com/nipscernlab/aurora/discussions) rather than an
issue.
