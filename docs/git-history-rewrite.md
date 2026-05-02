# Git history rewrite — removing bundled binaries from history

> **Status:** Plan. Nothing has been rewritten yet. Read this end-to-end
> before running anything. The operations described here **rewrite git
> history**, which is a destructive, all-or-nothing operation that affects
> every clone of the repository.

## Why we're doing this

`git count-objects -vH` currently reports:

```
in-pack: 16356
size-pack: 549.39 MiB
```

vs. ~7 MiB of actual source. The bloat comes from bundled Windows toolchain
binaries (`yosys.exe`, `ivl.exe`, `netlistsvg.exe`, `gtkwave.exe`,
`fancyFractal.exe`, `surfer.exe`, `*.dll`, …) that have been replaced
several times and now sit forever in the pack file.

Fix: move those binaries to GitHub Releases (see [`RELEASE.md`](../RELEASE.md))
and excise them from history.

## The biggest offenders

From `git rev-list --objects --all | git cat-file --batch-check ... | sort -nr`:

| Size  | Path                                                                            |
|-------|---------------------------------------------------------------------------------|
| 78 MB | `saphoComponents/Packages/FFPGA/dist/fancyFractal.exe`                          |
| 78 MB | `saphoComponents/Packages/FFPGA/build/Enhanced_Fractal_Visualizer/...pkg`       |
| 74 MB | `saphoComponents/Packages/FFPGA/fancyFractal.exe`                               |
| 56 MB | `saphoComponents/Packages/PRISM/yosys/ivl/ivl.exe`                              |
| 54 MB | `components/Packages/PRISM/netlistsvg/netlistsvg.exe`                           |
| 32 MB | `saphoComponents/Packages/PRISM/yosys/icudata73.dll`                            |
| 30 MB | `saphoComponents/Packages/FFPGA/dist/fancyFractal.exe` (older blob)             |
| 30 MB | `saphoComponents/Packages/FFPGA/build/build_fractal/fancyFractal.pkg`           |
| 27 MB | `saphoComponents/Packages/PRISM/netlistsvg/netlistsvg.exe`                      |
| 26 MB | `components/Packages/PRISM/yosys/libstdc++-6.dll`                               |
| 26 MB | `saphoComponents/Packages/PRISM/yosys/libpython3.11.dll`                        |
| 25 MB | `saphoComponents/Packages/FFPGA/dist/fancyFractal.exe` (another revision)       |
| 25 MB | `saphoComponents/Packages/FFPGA/build/fancyFractal/fancyFractal.pkg`            |
| 22 MB | `components/Packages/PRISM/yosys/yosys.exe`                                     |
| 22 MB | `saphoComponents/Packages/PRISM/yosys/yosys.exe`                                |
| 20 MB | `saphoComponents/Packages/FFPGA/build/Enhanced_Fractal_Visualizer/PYZ-00.pyz`   |
| 19 MB | `saphoComponents/Packages/iverilog-v1.exe`                                      |
| 19 MB | `saphoComponents/Packages/Surfer/surfer.exe`                                    |
| 19 MB | `saphoComponents/Packages/surfer/surfer.exe`                                    |
| 17 MB | `saphoComponents/Packages/PRISM/yosys/yosys-abc.exe`                            |
| 15 MB | `saphoComponents/Packages/PRISM/yosys/ivl/vhdlpp.exe`                           |
| 13 MB | `saphoComponents/Packages/PRISM/yosys/plugins/slang.so`                         |
| 13 MB | `saphoComponents/bin/fancySVG.exe`                                              |

Generally: **anything under `components/Packages/`, `saphoComponents/`,
`pythonSurfer/`, or any `.exe` / `.dll` / `.tgt` / `.vpi` / `.pkg` /
`.pyz` / `.so` / large `.vcd`** belongs in releases, not in history.

## Decision points (read this first)

Before you start, decide three things:

### 1. Who owns the canonical history?

History rewrites change every commit hash from the rewrite point forward.
Anyone with a clone has to either:

- delete their clone and re-clone, **or**
- run `git fetch origin && git reset --hard origin/main` and lose any
  local commits that aren't pushed.

If multiple maintainers have outstanding feature branches, coordinate a
freeze first and merge or rebase those branches **before** the rewrite.

### 2. What about open PRs?

All open PRs will have to be reopened against the new history. Plan for
1–2 hours of janitorial work re-cherry-picking unmerged changes.

### 3. What about forks?

GitHub will not auto-update forks. Fork owners need to either re-fork or
do the same hard-reset dance.

## The plan

1. **Cut a backup**: clone the repo to a separate folder, push to a new
   "archive" repo on GitHub. If anything goes wrong, the archive is the
   source of truth.
2. **Cut the toolchain release** so the binaries we're about to delete
   from history have a permanent home (see [`RELEASE.md`](../RELEASE.md)).
3. **Run `git filter-repo`** to remove the binary paths from every
   commit in history.
4. **Force-push** the rewritten history to `origin/main` (and any other
   long-lived branches).
5. **Garbage-collect** locally to reclaim disk: `git gc --prune=now --aggressive`.
6. **Tell every contributor** to re-clone.

We use `git filter-repo` and not `git filter-branch` because the latter
is officially deprecated, much slower, and prone to leaving rewritable
state behind.

## Step-by-step

> **Warning:** Steps 4 and 5 are destructive. Stop at step 3 if you have
> any doubts and ask for review.

### Step 0 — install `git filter-repo`

```powershell
pip install git-filter-repo
git filter-repo --version
```

### Step 1 — back up the repo

```powershell
cd ..
git clone --mirror https://github.com/nipscernlab/Aurora.git aurora-backup.git
# Optional: push to a private archive repo
# gh repo create nipscernlab/Aurora-archive --private --source=aurora-backup.git --push
```

Keep `aurora-backup.git` somewhere safe until you've confirmed the
rewrite works end-to-end.

### Step 2 — cut the toolchain release

See [`RELEASE.md`](../RELEASE.md). This must happen **before** the
rewrite, because once the binaries are gone from history they are gone
from every clone.

### Step 3 — rewrite history

Work on a fresh clone of the repo, not on your day-to-day worktree:

```powershell
cd ..
git clone https://github.com/nipscernlab/Aurora.git aurora-rewrite
cd aurora-rewrite
```

Build a paths file describing what to drop. Save this as `paths-to-strip.txt`
at the repo root:

```
components/Packages/
saphoComponents/Packages/
saphoComponents/Scripts/build/
saphoComponents/bin/
pythonSurfer/
*.exe
*.dll
*.tgt
*.vpi
*.so
*.pkg
*.pyz
*.vcd
Tutorial-de-Download-e-Instalacao-AURORA-NIPSCERN-Lab.pdf
```

Then run:

```powershell
git filter-repo --paths-from-file paths-to-strip.txt --invert-paths
```

The `--invert-paths` flag tells filter-repo to *remove* anything matching
those paths from every commit, rather than keeping only those paths.

Verify the new size:

```powershell
git count-objects -vH
git rev-list --objects --all | git cat-file --batch-check='%(objectsize) %(rest)' |
  Sort-Object { [int64]($_ -split ' ',2)[0] } -Descending | Select-Object -First 20
```

You should see `size-pack` drop from ~550 MiB to under ~10 MiB.

### Step 4 — force-push

```powershell
# Re-add the remote (filter-repo strips it on purpose)
git remote add origin https://github.com/nipscernlab/Aurora.git
git push --force --all origin
git push --force --tags origin
```

### Step 5 — local cleanup

```powershell
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Step 6 — announce

Post in Issues / Discussions:

> AURORA's git history was rewritten on **YYYY-MM-DD** to remove ~540 MiB
> of bundled binaries that now live in GitHub Releases. **Please re-clone
> the repository** (or `git fetch origin && git reset --hard origin/main`).
> Open PRs need to be rebased onto the new `main`.

### Step 7 — verify

- Clone the repo fresh into a new folder.
- `git log --all --oneline | wc -l` should match what it was before.
- `git count-objects -vH` should show <20 MiB.
- The current working tree should look identical to what it looked like
  pre-rewrite (only history is gone — not the latest content).
- Open the IDE in dev mode (`npm install && npm start`) — it should
  detect that `components/Packages/` is missing and offer to download
  the toolchain bundle.

## What if it goes sideways

You still have `aurora-backup.git` from step 1.

```powershell
cd ../aurora-backup.git
git push --force --mirror https://github.com/nipscernlab/Aurora.git
```

That puts everything back exactly as it was.

## Future-proofing

After the rewrite:

- The new `.gitignore` already excludes `components/Packages/` and
  `saphoComponents/Packages/`, so accidentally committing a binary
  becomes a `git add -f` away — i.e. you have to want it.
- Optional: enable [`git lfs`](https://git-lfs.com) for any large files
  that genuinely belong in version control (textures, PDF docs the IDE
  ships, etc.).
- Optional: add a pre-receive hook on the GitHub side (or a CI lint
  step) that rejects pushes containing files larger than, say, 5 MiB.

## Cheat sheet

```powershell
# What's the largest file in the current tree?
Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' } |
  Sort-Object Length -Descending | Select-Object -First 20 Length, FullName

# What's the largest blob in history?
git rev-list --objects --all |
  git cat-file --batch-check='%(objectsize) %(rest)' |
  Sort-Object { [int64]($_ -split ' ',2)[0] } -Descending |
  Select-Object -First 20

# Repo pack size (before vs after)
git count-objects -vH
```
