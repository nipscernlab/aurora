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

## Changing a file

Two rules apply to every change, however small.

A file you edit leaves the change in TypeScript. If it is still `.js`, convert
it first, in strict mode, in a commit of its own, and make the actual change in
a second commit. Files under about 500 lines are renamed whole. For a larger
file with state or DOM code, extract the part you are about to touch into a new
`.ts` module and import it back, rather than converting thousands of lines for
a small edit. `npm run build:ts` emits the `.js` next to each `.ts`, the
generated file goes in `.gitignore`, and `node scripts/check-types.js` must stay
green: a converted file is born with zero type errors.

Every line the change touches is exercised by a test. That covers the
conversion as much as the feature, because fixing a type error usually means
adding a guard for `null` or `undefined`, and on a line no test runs that guard
changes behaviour without anyone noticing. Run `npm run test:coverage` and check
the changed lines in `coverage/lcov.info`. When they are not covered, write the
test before the change, watch it pass on the old code, and keep it passing
through the conversion and the edit. Code that a unit test cannot reach, such as
window layout or the boot sequence, gets an end-to-end test under `tests/e2e/`,
run with `npm run test:e2e`.

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

Only the maintainers' accounts drive this. Both `release-please.yml` and the
preflight job of `release.yml` check `github.actor` against the same short list,
so a push by another contributor does not refresh the release pull request (the
next maintainer push does), and a merge of it by another account does not become
a release. The list lives in those two places and in `.github/CODEOWNERS`; when
the maintainers change, change all three in one commit. The hard lock is on the
GitHub side: a tag ruleset lets only admins create `v*` tags on
`nipscernlab/sapho`.

### When a publish fails

The tag and the GitHub release can exist without an installer, when the build
fails after release-please has done its part. Retry from Actions: run the
Release workflow by hand, choosing the version tag under "Use workflow from",
with both boxes unchecked. The `concurrency` group keeps two publishes from
racing onto the distribution channel, so a retry while another run is still
going waits instead of producing a half-uploaded release.

### The publish token

The default `GITHUB_TOKEN` is scoped to this repository and cannot write to
`nipscernlab/sapho`, so the publish uses the `SAPHO_RELEASE_TOKEN` secret: a
fine-grained personal access token with resource owner `nipscernlab`, access to
the `sapho` repository only, and `Contents: Read and write`. It has to belong to
an admin of `sapho`, because of the tag ruleset above.

Being personal, the token goes with the person. Rotate it when a maintainer
leaves and before it expires: create the new one, paste it into this
repository's Settings, Secrets and variables, Actions, then run the Release
workflow by hand with `dry_run` checked. That run only checks access and should
end with "Publish access to nipscernlab/sapho confirmed". Revoke the old token
after that, not before. An expired token fails the preflight in seconds, with a
message that says so, rather than after the twenty-minute build.

### Code signing

The installer is signed through the SignPath Foundation, organisation SAPHO
[OSS], project `aurora`. The workflow reads the `SIGNPATH_API_TOKEN` secret,
which belongs to the organisation's CI user and not to any maintainer, and three
variables: `SIGNPATH_ORG_ID`, `SIGNPATH_PROJECT_SLUG` and
`SIGNPATH_POLICY_SLUG`.

The policy variable decides what happens. On `test-signing` a real release is
published unsigned, as every release so far has been, and the run says so in a
warning. That is deliberate: the test certificate is self-signed, and an
installer signed with it looks worse to Windows than an unsigned one. To
rehearse signing, run the workflow by hand with `sign_only` checked; the signed
installer stays in the run's artifacts and reaches nobody. Once SignPath issues
the production certificate, switching the variable to `release-signing` is what
turns signing on. [TODO.md](TODO.md), section 3, tracks what is still open.

Each approver has an individual SignPath account with two-factor authentication,
and the public policy at [nipscern.com/code-signing](https://www.nipscern.com/code-signing)
names them. SignPath requires that page, so a change of approvers is also an
edit to `code-signing.html` in `nipscernlab/nipscernweb`.

### Around the application

Two jobs sit outside this repository but belong to the same maintenance. The
user manual is written in `nipscernlab/docs_aurora`, whose README covers
building, publishing and the Windows-only requirements; installed copies fetch a
new manual on their own. When YANC changes the C± or assembly surface,
regenerate `resources/sapho_rules.json` as described in the README under
[Keeping the language rules in sync](README.md#keeping-the-language-rules-in-sync).

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
