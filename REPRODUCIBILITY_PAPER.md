# Reprodutibilidade — medições de tempo de simulação (paper)

Branch `paper-sim-abril2026`. Congela o ambiente usado para medir o tempo de
simulação de três processadores SAPHO de pesos distintos, na AURORA da época do
paper com o toolchain YANC contemporâneo.

## Ambiente

- **AURORA:** v4.1.12+25, commit `820ad2a` (2026-04-06, "for paper"). Versão só
  com Icarus Verilog / GTKWave / vvp — sem Verilator, Surfer ou IA (todos
  posteriores a maio/2026).
- **YANC (toolchain):** reconstruído do fonte no commit `7d4f90c` (2026-03-23),
  contemporâneo da AURORA de abril. Os binários do disco eram YANC 5.2 (CLI de
  flags, incompatível com a CLI posicional que a AURORA de abril invoca), então
  foram rebuildados da era.

### Como os binários da era foram gerados

O YANC não versionou binários após v2.19.0 (mar/2025), e o disco só tinha o 5.2.
Reconstruídos do fonte `7d4f90c` seguindo a receita do próprio `build.bat` da era:

- **flex/bison:** winflexbison 2.5.25 (win_flex 2.6.4 + win_bison 3.8.2).
- **gcc:** mingw64 do bundle msys da AURORA (`x86_64-w64-mingw32-gcc`).
- Recipe: `bison -y -d CMMComp.y` + `flex CMMComp.l` + `gcc` sobre os `.c`
  (idem asmcomp/appcomp com flex; comp2gtkw direto). Binários resultantes em
  `components/bin/` (`cmmcomp`, `asmcomp`, `appcomp`, `comp2gtkw`).
- **Importante:** o HDL e os Macros também são da era (`components/HDL/`,
  `components/Macros/`) — os binários geram código com ops de ULA float
  (ex.: `F_SU2`) que o HDL de abril não definia. Binários e HDL são um par
  casado; misturar quebra a elaboração no iverilog.

## Processadores medidos (10 rodadas cada)

Fontes originais em `Exemplos/` do YANC `7d4f90c`.

| Peso | Proc | Algoritmo | CLK (MHz) | Number of Clocks |
|---|---|---|---|---|
| Leve | `proc_rls` | RLS — filtro adaptativo, matriz 4×4, notação de Dirac (20 iterações) | 100 | 2 000 000 |
| Médio | `Seno` | Seno via LUT + interpolação (1000 amostras) | 100 | 2 000 000 |
| Pesado | `DTW` (project-oriented) | Dynamic Time Warping: `ZeroCross` (cascata biquad + detector de cruzamento por zero) + `ProcDTW` (matriz DP 75×75), unidos por top-level + máquina de estados + testbench | 100 | 700 000 |

O DTW é *project-oriented*: dois processadores unidos por `top_level.v` +
`maq_estados.v` + `top_level_tb.v` (testbench próprio que injeta `sinal_harm_q.txt`,
640 amostras). O tempo do DTW é governado pelo Number of Clocks (o testbench
instrumentado usa esse limite); 700 000 → ~90 s.

## Resultados (tempo de simulação vvp, ms)

| Proc | n | Média | Desvio | CV | Min–Max |
|---|---|---|---|---|---|
| RLS (leve) | 10 | 876,9 | 38,9 | 4,4 % | 786–938 |
| Seno (médio) | 10 | 10 080,0 | 286,3 | 2,8 % | 9 745–10 761 |
| DTW (pesado) | 10 | 87 175,8 | 2 513,6 | 2,9 % | 82 317–91 077 |

Razões (média): Seno/RLS = 11,5× · DTW/Seno = 8,8× · DTW/RLS = 100,8×.

O tempo de simulação reflete o **volume de trabalho** (clocks), não a
complexidade algorítmica: o RLS é o mais sofisticado mas roda 20 iterações; o
Seno é simples mas processa 1000 amostras.

## Fluxo de medição

O tempo é medido pelo cronômetro de ms embutido (`[TIMING] Tempo de simulacao
(vvp): N ms`), que cronometra o wall-clock do processo `vvp` (spawn→close). Por
rodada: limpar os terminais → compilar → simular → exportar o log (botão de
export → `.txt` com todos os terminais e timestamps). Extração:
`grep "\[TIMING\]" *.txt`. Máquina limpa, sem outras cargas.

- Seno/RLS: compile individual do processador.
- DTW: **Full Build** (project-oriented) — compila os dois procs com
  `projectParam=1` (sem `$finish` standalone) e simula.

## Correções desta branch (sobre a v4.1.12)

Todas mínimas e voltadas à medição; não alteram os algoritmos nem o `vvp`.

- **Botão de export de log** dos terminais em `.txt` (o botão existia mas estava
  sem handler; passou a exportar todos os terminais com timestamps).
- **`[TIMING]`**: cronômetro de ms do `vvp` nos três caminhos (serial, paralelo
  e projeto).
- **`fix.vcd`** restaurado (VCD dummy que o YANC removeu depois da era).
- **`moment`** → `Date` nativo (dependência removida da toolchain depois da era).
- **Detecção project-oriented por `projectOriented.json`** (a UI da era detectava
  por elementos que nem sempre estavam no estado esperado, gerando um `$finish`
  standalone que encerrava a simulação do DTW em ~66 µs, antes do trabalho pesado).

## O que não está versionado

`components/Packages/` (toolchain baixado: msys/iverilog/gtkwave/python — via
bootstrap) e artefatos de build (`.tmp-build/`, `_*_backup/`). Os binários da
era em `components/bin/` **estão** versionados por serem trabalhosos de refazer.
