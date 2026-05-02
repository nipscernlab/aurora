# Contributing to AURORA

First off, thank you for considering contributing to AURORA. The IDE
benefits from every well-formed bug report, design discussion, and pull
request — small fixes included.

This document is intentionally brief. If you've contributed to a Node /
Electron project before, nothing here will surprise you.

## Code of conduct

By participating, you agree to abide by the
[Contributor Covenant](CODE_OF_CONDUCT.md).

## Reporting bugs

Please open an issue using the **Bug report** template and include:

1. **What you did** (steps to reproduce, ideally on a fresh project).
2. **What you expected** to happen.
3. **What actually happened**, including screenshots and the relevant
   terminal output (TCMM / TASM / TVERI / TWAVE).
4. Your environment: AURORA version (`Help ▸ About` or
   `package.json#version`), Windows build, Node version if you build
   from source.

If the bug touches the SAPHO toolchain (Icarus, GTKWave, Yosys), include
the exact command AURORA logged so the problem can be reproduced outside
the IDE.

## Suggesting features

Open an issue with the **Feature request** template. The most useful
proposals describe:

* the user problem you're trying to solve,
* the workflow you'd want instead,
* and any design constraints (HDL workflow, performance, accessibility).

Implementation sketches are welcome but not required.

## Pull requests

1. Fork the repo and create a topic branch from `main`:
   `git checkout -b fix/short-description`.
2. Run `npm install` and `npm start` to confirm the IDE still launches
   on your machine.
3. Keep changes focused — one logical change per PR makes review fast.
4. Match the existing code style: 4-space indent for JS, single quotes,
   ES modules, no semicolons-only style changes mixed with logic.
5. Update or add comments where the *why* is non-obvious. The repo's
   convention is to omit obvious "what" comments.
6. If you touch a renderer module that participates in the editor or
   compilation flow, smoke-test by opening a SAPHO project, splitting
   the editor, editing, saving, and running each compile button.
7. Open the pull request against `main`, fill out the template, and
   reference any related issues with `Fixes #123`.

### Commit messages

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(tree): per-processor colors, unified icons, hierarchy fixes
fix(split): give each pane its own Monaco model
refactor(tabs): split TabManager into core + viewer/drag/watcher mixins
docs(readme): refresh project layout section
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`,
`chore`, `build`, `ci`, `perf`.

### Linting

```powershell
npm run lint        # if eslint script is wired
npx eslint .
```

Please fix lint warnings in files you've touched; avoid sweeping
unrelated reformatting in the same PR.

## Releasing (maintainers)

Releases are produced via `electron-builder` and published to GitHub:

```powershell
npm version patch     # or minor / major
npm run build         # writes dist/ artifacts
# CI will publish on tag push.
```

Large bundled binaries (toolchain executables) live in GitHub Releases,
not in the source tree. See [`RELEASE.md`](RELEASE.md) for the rationale
and the bootstrap command end users run on first launch.

## Project structure

See the **Project layout** section of the [README](README.md). The
short version: rendering UI lives under `js/`, IPC handlers under
`main/ipc/`, and styles under `css/`, organised by the area of the UI
they style.

## Questions

For questions that aren't bug reports or feature requests, please open
a [GitHub Discussion](https://github.com/nipscernlab/Aurora/discussions)
rather than an issue.
