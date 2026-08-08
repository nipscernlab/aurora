# README media assets

Screenshots and demo recordings for the root [README.md](../../README.md) go
here. The README currently says they are pending and points at this folder; when
the files exist, replace that sentence with the images.

Recommended shot list:

| File | What it shows | Size hint |
|---|---|---|
| `hero.png` | The IDE with a project open (editor + tree + terminal) | ~1600px wide |
| `split-editor.gif` | Splitting a pane; live model sharing across panes | short loop |
| `compile.gif` | A full C± → ASM → Verilog → simulate run, terminal streaming | short loop |
| `prism.gif` | PRISM RTL viewer (Yosys + netlistsvg) zoom/pan | short loop |
| `waveform.gif` | Surfer/GTKWave waveform from a simulation | short loop |

Keep GIFs small (a few MB each). Optimise with `gifsicle -O3` or export
as muted MP4 if size becomes a problem.
