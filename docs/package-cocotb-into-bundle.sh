#!/usr/bin/env bash
# =============================================================================
# package-cocotb-into-bundle.sh
#
# Monta o cocotb (com a VPI do Verilator) DENTRO do python que o bundle do
# verilator ja embarca (3.12.11), e TESTA o bundle de forma standalone (so com
# o python/verilator/g++/perl/make do PROPRIO bundle — nao o MSYS2 do sistema).
#
# Pre-requisito: ter rodado docs/build-cocotb-verilator.sh com Python 3.12 +
# gcc 15 (gera o venv ~/aurora-cocotb-venv com cocotb + libcocotbvpi_verilator.a
# + runner patchado). Rode no shell MSYS2 MINGW64.
#
#   bash docs/package-cocotb-into-bundle.sh [CAMINHO_DO_BUNDLE]
# default do bundle: a copia local do Aurora.
# =============================================================================
set -euo pipefail
say() { printf '\n==> %s\n' "$*"; }

BUNDLE="${1:-/c/nipscern/Aurora/components/Packages/verilator}"
VENV="${COCOTB_VENV:-$HOME/aurora-cocotb-venv}"
VPY="$VENV/bin/python"; [ -x "$VPY" ] || VPY="$VENV/Scripts/python.exe"

[ -x "$BUNDLE/mingw64/bin/python.exe" ] || { echo "ERRO: bundle sem mingw64/bin/python.exe em $BUNDLE" >&2; exit 1; }
[ -x "$VPY" ] || { echo "ERRO: venv nao encontrado em $VENV (rode build-cocotb-verilator.sh)." >&2; exit 1; }

# Versoes tem que casar (o cocotb linka -lpythonX.Y).
BV="$("$BUNDLE/mingw64/bin/python.exe" -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
VV="$("$VPY" -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
say "Python do bundle: $BV | Python do venv (build do cocotb): $VV"
[ "$BV" = "$VV" ] || { echo "ERRO: versoes diferentes ($BV vs $VV) — o cocotb nao vai casar. Builde o cocotb no mesmo X.Y do bundle." >&2; exit 1; }

PYV="py$BV"
SYSLIB="$("$VPY" -c 'import sysconfig;print(sysconfig.get_path("stdlib"))')"   # stdlib FULL (base do venv)
VENV_SP="$("$VPY" -c 'import sysconfig;print(sysconfig.get_path("purelib"))')" # site-packages do venv (cocotb)
BUNDLE_LIB="$BUNDLE/mingw64/lib/python$BV"
BUNDLE_SP="$BUNDLE_LIB/site-packages"
say "stdlib full:   $SYSLIB"
say "venv site-pkgs: $VENV_SP"
say "bundle lib:    $BUNDLE_LIB"

# ---- 1. De-stripa o stdlib do bundle (sem clobber do que ja existe) -------
# cocotb importa varios modulos (logging, importlib, ctypes, argparse, etc.)
# que o bundle pode ter removido. Copia os que faltam, SEM sobrescrever e SEM
# arrastar o site-packages do sistema (pip/setuptools/etc. nao vao pro bundle).
say "De-stripando o stdlib do bundle (copia modulos faltantes, exceto site-packages)..."
mkdir -p "$BUNDLE_LIB"
( cd "$SYSLIB" && for item in * .[!.]*; do
    [ -e "$item" ] || continue
    [ "$item" = "site-packages" ] && continue
    cp -rn "$item" "$BUNDLE_LIB/" 2>/dev/null || true
  done )

# ---- 2. Copia cocotb + deps do venv pro site-packages do bundle -----------
say "Copiando cocotb/cocotb_tools/pygpi/find_libpython pro bundle..."
mkdir -p "$BUNDLE_SP"
for pkg in cocotb cocotb_tools pygpi; do
  rm -rf "$BUNDLE_SP/$pkg"
  cp -r "$VENV_SP/$pkg" "$BUNDLE_SP/"
done
# find_libpython: dep do runner (modulo unico find_libpython.py [+ __main__]
# ou pacote) + dist-info. Copia TUDO que casa find_libpython* — e falha se
# nada existir (era um cp silencioso que escondia o erro).
_fl=0
for fl in "$VENV_SP"/find_libpython*; do
  [ -e "$fl" ] || continue
  cp -rf "$fl" "$BUNDLE_SP/"; _fl=1
done
[ "$_fl" = 1 ] || { echo "ERRO: find_libpython nao achado em $VENV_SP" >&2; exit 1; }
cp -rf "$VENV_SP"/cocotb-*.dist-info "$BUNDLE_SP/" 2>/dev/null || true

# ---- 3. Garante a libcocotbvpi_verilator.a no cocotb/libs do bundle -------
# (ja vem dentro de cocotb/libs via passo 2, mas confirma)
if [ -f "$BUNDLE_SP/cocotb/libs/libcocotbvpi_verilator.a" ]; then
  say "VPI estatica presente no bundle: cocotb/libs/libcocotbvpi_verilator.a"
else
  echo "ERRO: libcocotbvpi_verilator.a nao veio junto. Rode rebuild-vpi.sh antes." >&2; exit 1
fi

# ---- 4. DLLs core do python no mingw64/bin do bundle ----------------------
# cocotb.dll/gpi.dll/etc. dependem de libpython3.X.dll, libstdc++-6.dll,
# libgcc_s_seh-1.dll, libwinpthread-1.dll. O bundle ja tem (verilator/g++ usam),
# mas garante a libpython.
need_dll() { [ -f "$BUNDLE/mingw64/bin/$1" ] || echo "  FALTA dll: $1 (copie do mingw64/bin do sistema)"; }
say "Conferindo DLLs runtime no bundle/mingw64/bin..."
for d in "libpython$BV.dll" libstdc++-6.dll libgcc_s_seh-1.dll libwinpthread-1.dll; do need_dll "$d"; done

# ---- 5. Teste STANDALONE: so com o toolchain do BUNDLE --------------------
say "Teste standalone (PATH = SO o bundle)..."
WORK="${SMOKE_DIR:-$HOME/aurora-bundle-smoke}"; rm -rf "$WORK"; mkdir -p "$WORK"
cat > "$WORK/dff.v" <<'V'
module dff (input clk, input d, output reg q);
  always @(posedge clk) q <= d;
endmodule
V
cat > "$WORK/test_dff.py" <<'PY'
import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer
@cocotb.test()
async def dff_passes_d_to_q(dut):
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    dut.d.value = 1
    await RisingEdge(dut.clk); await Timer(1, unit="ns")
    assert int(dut.q.value) == 1
    dut.d.value = 0
    await RisingEdge(dut.clk); await Timer(1, unit="ns")
    assert int(dut.q.value) == 0
PY
cat > "$WORK/run.py" <<'PY'
from pathlib import Path
from cocotb_tools.runner import get_runner
here = Path(__file__).parent
runner = get_runner("verilator")
runner.build(sources=[str(here/"dff.v")], hdl_toplevel="dff", build_dir=str(here/"sim_build"), always=True, waves=True)
runner.test(hdl_toplevel="dff", test_module="test_dff", build_dir=str(here/"sim_build"), test_dir=str(here), waves=True)
print(">>> BUNDLE STANDALONE OK <<<")
PY

# PATH = SO o bundle (mingw64/bin + usr/bin) — prova que nao depende do MSYS2.
BPATH="$BUNDLE/mingw64/bin:$BUNDLE/usr/bin"
cd "$WORK"
if PATH="$BPATH" "$BUNDLE/mingw64/bin/python.exe" run.py; then
  say "PASS — cocotb+Verilator roda SO com o bundle. Empacotamento valido."
  echo "  Replique os passos 1-4 no build do bundle do yanc (versionado), nao so na copia local."
else
  say "FAIL — faltou algo no bundle (veja o erro: dll/modulo/etc.). Me cole a saida."
  exit 1
fi
