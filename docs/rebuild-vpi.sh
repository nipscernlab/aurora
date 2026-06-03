#!/usr/bin/env bash
# rebuild-vpi.sh — recompila SO a libcocotbvpi_verilator.a (estatica) e copia
# pro cocotb/libs/ do venv. Use quando so as flags da VPI mudaram (sem refazer
# o pip install). Rode no shell MSYS2 MINGW64.
#
#   bash docs/rebuild-vpi.sh
set -euo pipefail
say() { printf '\n==> %s\n' "$*"; }

VENV="${COCOTB_VENV:-$HOME/aurora-cocotb-venv}"
VPY="$VENV/bin/python"; [ -x "$VPY" ] || VPY="$VENV/Scripts/python.exe"
SRC="${COCOTB_SRC:-$HOME/aurora-cocotb-src}"
PKGDIR="$(ls -d "$SRC"/cocotb-*/ 2>/dev/null | head -1)"
[ -n "$PKGDIR" ] || { echo "ERRO: fontes do cocotb nao achadas em $SRC (rode build-cocotb-verilator.sh)." >&2; exit 1; }

LIBS="$("$VPY" -c 'import cocotb_tools.config as c; print(c.libs_dir)')"
PYINC="$("$VPY" -c 'import sysconfig; print(sysconfig.get_path("include"))')"
INC="$PKGDIR/src/cocotb/share/include"
VPIDIR="$PKGDIR/src/cocotb/share/lib/vpi"
VROOT="$(verilator --getenv VERILATOR_ROOT 2>/dev/null || true)"
[ -n "$VROOT" ] || VROOT="$(dirname "$(command -v verilator)")/../share/verilator"

say "libs dir: $LIBS"
say "verilator root: $VROOT"
say "Compilando libcocotbvpi_verilator.a (vpi_user.h do verilator, PLI_DLLISPEC vazio)..."
OBJ="$SRC/vpi_verilator_obj"; rm -rf "$OBJ"; mkdir -p "$OBJ"
for f in VpiImpl VpiCbHdl VpiObj VpiIterator VpiSignal; do
  g++ -O2 -std=c++11 -fvisibility=hidden -fvisibility-inlines-hidden \
      -DCOCOTBVPI_EXPORTS= -DVERILATOR= -D__STDC_FORMAT_MACROS= -DWIN32= -DPLI_DLLISPEC= \
      -I"$VROOT/include" -I"$VROOT/include/vltstd" \
      -I"$INC" -I"$PKGDIR/src/cocotb" -I"$PYINC" \
      -c "$VPIDIR/$f.cpp" -o "$OBJ/$f.o" || { echo "ERRO: falha compilando $f.cpp" >&2; exit 1; }
done
ar rcs "$OBJ/libcocotbvpi_verilator.a" "$OBJ"/*.o
cp -f "$OBJ/libcocotbvpi_verilator.a" "$LIBS/"
say "OK — $LIBS/libcocotbvpi_verilator.a atualizada."
