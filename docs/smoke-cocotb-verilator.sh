#!/usr/bin/env bash
# =============================================================================
# smoke-cocotb-verilator.sh
#
# Roda uma simulacao cocotb MINIMA no Verilator usando o venv preparado por
# build-cocotb-verilator.sh — o teste decisivo de que:
#   (a) o exe verilado LINKA a libcocotbvpi_verilator.a estatica + os DLLs core
#       do cocotb (gpi/gpilog/cocotbutils) e resolve os vpi_*;
#   (b) o runtime do cocotb sobe (python embed) e o teste roda ate o fim.
#
# >>> RODE NO MESMO shell "MSYS2 MINGW64" (verilator/g++/make/perl no PATH). <<<
#
# Uso:
#   bash docs/smoke-cocotb-verilator.sh
#   (COCOTB_VENV=/caminho/do/venv se nao for o default ~/aurora-cocotb-venv)
# =============================================================================
set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }

[ "${MSYSTEM:-}" = "MINGW64" ] || { echo "ERRO: rode no shell 'MSYS2 MINGW64'." >&2; exit 1; }

VENV="${COCOTB_VENV:-$HOME/aurora-cocotb-venv}"
VPY="$VENV/bin/python"; [ -x "$VPY" ] || VPY="$VENV/Scripts/python.exe"
[ -x "$VPY" ] || { echo "ERRO: venv nao encontrado em $VENV (rode build-cocotb-verilator.sh antes)." >&2; exit 1; }

# Python 3.14: ainda precisa do escape do cocotb em runtime tb.
export COCOTB_IGNORE_PYTHON_REQUIRES=1

WORK="${SMOKE_DIR:-$HOME/aurora-cocotb-smoke}"
say "Pasta de teste: $WORK"
rm -rf "$WORK"; mkdir -p "$WORK"

# ---- DUT minimo: um D flip-flop ------------------------------------------
cat > "$WORK/dff.v" <<'V'
module dff (input clk, input d, output reg q);
  always @(posedge clk) q <= d;
endmodule
V

# ---- Teste cocotb ---------------------------------------------------------
cat > "$WORK/test_dff.py" <<'PY'
import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer


@cocotb.test()
async def dff_passes_d_to_q(dut):
    cocotb.start_soon(Clock(dut.clk, 10, units="ns").start())
    dut.d.value = 1
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")
    assert int(dut.q.value) == 1, f"esperava q=1, veio q={dut.q.value}"
    dut.d.value = 0
    await RisingEdge(dut.clk)
    await Timer(1, units="ns")
    assert int(dut.q.value) == 0, f"esperava q=0, veio q={dut.q.value}"
PY

# ---- Runner: get_runner("verilator") -------------------------------------
cat > "$WORK/run.py" <<'PY'
import os
import shutil
# verilator do mingw e script perl sem extensao -> shutil.which do Python no
# Windows nunca acha nome puro (3.12.1+ ignora ext vazia). Fallback: varre PATH.
_orig_which = shutil.which
def _which(cmd, *a, **k):
    r = _orig_which(cmd, *a, **k)
    if r is None and os.path.basename(str(cmd)) == "verilator":
        for d in os.environ.get("PATH", "").split(os.pathsep):
            p = os.path.join(d, "verilator")
            if os.path.isfile(p):
                return p
    return r
shutil.which = _which
from pathlib import Path
from cocotb_tools.runner import get_runner

here = Path(__file__).parent
build_dir = str(here / "sim_build")

runner = get_runner("verilator")
runner.build(
    sources=[str(here / "dff.v")],
    hdl_toplevel="dff",
    build_dir=build_dir,
    always=True,
    waves=True,
)
runner.test(
    hdl_toplevel="dff",
    test_module="test_dff",
    build_dir=build_dir,
    test_dir=str(here),
    waves=True,
)
print(">>> SMOKE OK <<<")
PY

say "Rodando cocotb no Verilator..."
cd "$WORK"
if "$VPY" run.py; then
  say "PASS — cocotb rodou no Verilator! (veja '>>> SMOKE OK <<<' acima e results.xml em sim_build)"
  ls -1 "$WORK/sim_build" 2>/dev/null | sed 's/^/    /' || true
else
  say "FAIL — a sim cocotb+verilator nao completou. Cole a saida acima (erro de link do exe verilado ou de runtime)."
  exit 1
fi
