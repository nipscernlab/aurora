#!/usr/bin/env bash
# =============================================================================
# build-cocotb-verilator.sh
#
# Produz um Python mingw com cocotb + SUPORTE A VERILATOR (a lib
# `libcocotbvpi_verilator`) pra empacotar no bundle do verilator do Aurora.
#
# >>> RODE NUM MSYS2 COMPLETO (atalho "MSYS2 MINGW64"), onde o pacman existe. <<<
#
# Por que isto e necessario
# -------------------------
# O wheel NATIVO de Windows do cocotb (o que vive em
# components/Packages/python/) NAO traz suporte a Verilator: faltam o
# `libcocotbvpi_verilator` (que o runner do cocotb linka via
# `-lcocotbvpi_verilator`) e o `verilator` nao resolve via shutil.which.
#
# A solucao e rodar o cocotb pelo MESMO ambiente do verilator (mingw/MSYS2):
# construindo o cocotb DO SOURCE dentro do mingw (que tem g++/make/perl +
# verilator no PATH), o build do cocotb compila o `libcocotbvpi_verilator`.
# Depois e so empacotar esse Python mingw (com o cocotb) no bundle do
# verilator e apontar o fluxo cocotb+Verilator do Aurora pra ele.
#
# O Python mingw que vem HOJE no bundle e stripado (sem urllib/pip) e NAO
# serve — por isso instalamos um Python mingw completo aqui via pacman.
#
# Uso:
#   1) ATUALIZE o MSYS2 ANTES (evita "DLL load failed ... pyexpat" e afins,
#      sintoma de DLLs fora de sincronia apos um pacman parcial):
#        pacman -Syu
#      Se ele atualizar o core e pedir pra fechar o terminal, feche, reabra o
#      "MSYS2 MINGW64" e rode `pacman -Syu` ate dizer "nothing to do".
#      Se falhar com "Operation too slow"/mirror lento, e so RETRY — o pacman
#      retoma do cache (os pacotes baixados ficam em /var/cache/pacman/pkg).
#      Num MSYS2 muito desatualizado o -Syu e grande (centenas de pacotes);
#      deixe terminar antes de seguir.
#   2) bash docs/build-cocotb-verilator.sh
#
# Nota de versao: o pacman instala o Python mingw MAIS RECENTE. Se o cocotb
# nao buildar no Python muito novo (ex: 3.14), use uma versao que o cocotb
# suporte (3.11-3.13) — veja a checagem de versao logo abaixo.
# =============================================================================
set -euo pipefail

say() { printf '\n==> %s\n' "$*"; }

# ---- 1. Sanidade: tem que ser MSYS2 MINGW64 -------------------------------
if [ "${MSYSTEM:-}" != "MINGW64" ]; then
  echo "ERRO: rode no shell 'MSYS2 MINGW64' (MSYSTEM atual: '${MSYSTEM:-vazio}')." >&2
  echo "      pacman + os pacotes mingw-w64-x86_64-* so estao la." >&2
  exit 1
fi

# ---- 2. Toolchain via pacman ----------------------------------------------
# IMPORTANTE: NAO gerenciamos python NEM gcc aqui — eles precisam de VERSOES
# PINADAS (gcc 15, NAO 16 que tem bug de libstdc++; python <=3.13, idealmente
# 3.12 pra casar com o bundle). Instale-os voce e pine no IgnorePkg do
# /etc/pacman.conf, senao um `pacman -S`/-Syu re-sobe pra versao mais nova:
#   IgnorePkg = mingw-w64-x86_64-gcc mingw-w64-x86_64-gcc-libs mingw-w64-x86_64-python
# Aqui so garantimos verilator/make/perl (--needed pula o que ja existe).
say "Garantindo verilator/make/perl (pacman --needed)..."
pacman -S --needed --noconfirm \
  mingw-w64-x86_64-verilator \
  make \
  perl

# ---- 3. Confirma que tudo resolve no PATH ---------------------------------
# O build do cocotb so compila a VPI do verilator se o verilator/g++/make
# estiverem visiveis durante o build.
say "Conferindo ferramentas no PATH..."
miss=0
for t in python verilator g++ make perl; do
  if command -v "$t" >/dev/null 2>&1; then
    printf '  ok    %-10s -> %s\n' "$t" "$(command -v "$t")"
  else
    printf '  FALTA %s\n' "$t"; miss=1
  fi
done
[ "$miss" = 0 ] || { echo "ERRO: instale o que falta antes de continuar." >&2; exit 1; }

# ---- 3b. Versao do Python -------------------------------------------------
# cocotb 2.0.x exige Python <= 3.13. O pacman instala o mais novo (hoje 3.14),
# que o cocotb REJEITA no build. Opcoes:
#   - ROBUSTO: instalar um Python mingw 3.13 (veja a mensagem de erro abaixo).
#   - RAPIDO/RISCO: ALLOW_PY314=1 forca o build no 3.14 via
#     COCOTB_IGNORE_PYTHON_REQUIRES (sem garantia de compilar/rodar).
PY_MAJ="$(python -c 'import sys; print(sys.version_info[0])')"
PY_MIN="$(python -c 'import sys; print(sys.version_info[1])')"
echo "  python: $PY_MAJ.$PY_MIN"
if [ "$PY_MAJ" -gt 3 ] || { [ "$PY_MAJ" -eq 3 ] && [ "$PY_MIN" -gt 13 ]; }; then
  if [ "${ALLOW_PY314:-0}" = "1" ]; then
    echo "  ALLOW_PY314=1 -> exportando COCOTB_IGNORE_PYTHON_REQUIRES (sem garantia)."
    export COCOTB_IGNORE_PYTHON_REQUIRES=1
  else
    cat >&2 <<EOF

ERRO: Python $PY_MAJ.$PY_MIN — cocotb 2.0.x so suporta ate 3.13.
  Escolha um caminho:
   (A) ROBUSTO — instale um Python mingw 3.13 e rode de novo. Ex.:
         pacman -U https://repo.msys2.org/mingw/mingw64/<mingw-w64-x86_64-python-3.13.X-Y-any.pkg.tar.zst>
       (pegue o arquivo 3.13 exato em https://repo.msys2.org/mingw/mingw64/ ;
        confirme o downgrade quando o pacman perguntar). Depois: bash $0
   (B) RAPIDO/RISCO — forcar no 3.14 (pode nao compilar/rodar):
         ALLOW_PY314=1 bash $0
EOF
    exit 1
  fi
fi

# ---- 4. venv + cocotb -----------------------------------------------------
# O MSYS2 marca o python do sistema como "externally managed" (PEP 668) e
# bloqueia `pip install`. Um venv resolve isso E isola o cocotb.
VENV="${COCOTB_VENV:-$HOME/aurora-cocotb-venv}"
say "Criando venv em: $VENV (recriando do zero)"
# Recria do zero: `python -m venv` num venv existente NAO troca o python.exe,
# entao um venv velho (ex: 3.14) sobreviveria a um downgrade do python.
rm -rf "$VENV"
python -m venv --copies "$VENV"
VPY="$VENV/bin/python"
[ -x "$VPY" ] || VPY="$VENV/Scripts/python.exe"   # layout Windows do venv

say "Atualizando pip/wheel no venv..."
"$VPY" -m pip install --upgrade pip wheel

# Baixa o sdist do cocotb: precisamos das FONTES da VPI (src/cocotb/share/lib/
# vpi/*.cpp) pra compilar a libcocotbvpi_verilator a mao (passo 6). O wheel
# nativo so traz a VPI do icarus.
SRC="${COCOTB_SRC:-$HOME/aurora-cocotb-src}"
say "Baixando o sdist do cocotb em: $SRC"
rm -rf "$SRC"; mkdir -p "$SRC"
"$VPY" -m pip download --no-binary :all: --no-deps --dest "$SRC" cocotb
TARBALL="$(ls "$SRC"/cocotb-*.tar.gz | head -1)"
[ -n "$TARBALL" ] || { echo "ERRO: sdist do cocotb nao baixou." >&2; exit 1; }
say "Extraindo $(basename "$TARBALL")"
tar -xf "$TARBALL" -C "$SRC"
PKGDIR="$(ls -d "$SRC"/cocotb-*/ | head -1)"

# Patch do runner: o exe verilado vai linkar a VPI ESTATICA (-lcocotbvpi_
# verilator). Como uma .a nao carrega dependencias, o exe tambem precisa
# linkar os DLLs core do cocotb (gpi/gpilog/cocotbutils) — adicionamos no
# LDFLAGS do passo de build do Verilator no runner. Substring unica e robusta.
say "Patch: runner do Verilator (LDFLAGS core libs + resolver do verilator)..."
"$VPY" - "$PKGDIR/src/cocotb_tools/runner.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()

# (1) LDFLAGS: o exe verilado linka a VPI ESTATICA; uma .a nao carrega
# dependencias, entao linkamos tb os DLLs core do cocotb. ALEM disso, o wrapper
# perl do verilator no Windows QUEBRA um -LDFLAGS multi-palavra nos espacos
# (verilator ve "-LC:/..." como opcao solta -> "Invalid option"). Fix: emitir
# cada flag como seu proprio "-LDFLAGS <token>" (verilator acumula). Reescreve
# o par "-LDFLAGS", f"-Wl,-rpath,{libs} ... -lcocotbvpi_verilator..." inteiro.
import re as _re
ld_pat = _re.compile(
    r'"-LDFLAGS",\s*f"-Wl,-rpath,\{cocotb_tools\.config\.libs_dir\}[^"]*",'
)
ld_repl = (
    '"-LDFLAGS", f"-L{cocotb_tools.config.libs_dir}",\n'
    '                "-LDFLAGS", "-lcocotbvpi_verilator",\n'
    '                "-LDFLAGS", "-lgpi",\n'
    '                "-LDFLAGS", "-lgpilog",\n'
    '                "-LDFLAGS", "-lcocotbutils",\n'
    '                "-LDFLAGS", "-static-libstdc++",\n'
    '                "-LDFLAGS", "-static-libgcc",'
)
# Sem "-Wl,-rpath,...": inutil no Windows/PE e o verilator escapa as virgulas
# (-Wl\,-rpath\,) -> g++ "unrecognized option". As core DLLs sao achadas via
# PATH no run. -static-libstdc++/-static-libgcc: o verilated.o referencia
# simbolos de libstdc++ que nao resolvem ao misturar com as DLLs prebuiltadas
# do cocotb; estatico deixa tudo consistente.
if not ld_pat.search(s):
    sys.exit("ERRO: par -LDFLAGS do Verilator nao encontrado no runner.")
s = ld_pat.sub(ld_repl, s, count=1)

# (2) Resolver do verilator: o `verilator` do mingw e script perl sem extensao
# e o shutil.which do Python no Windows nunca acha nome puro. Fallback: varre o
# PATH por um arquivo `verilator`.
wh_needle = (
    '        executable = shutil.which("verilator")\n'
    '        if executable is None:\n'
    '            raise SystemExit("ERROR: verilator executable not found!")\n'
)
wh_repl = (
    '        executable = shutil.which("verilator")\n'
    '        if executable is None:\n'
    '            import os as _os\n'
    '            for _d in _os.environ.get("PATH", "").split(_os.pathsep):\n'
    '                _p = _os.path.join(_d, "verilator")\n'
    '                if _os.path.isfile(_p):\n'
    '                    executable = _p\n'
    '                    break\n'
    '        if executable is None:\n'
    '            raise SystemExit("ERROR: verilator executable not found!")\n'
)
if wh_needle not in s:
    sys.exit("ERRO: bloco shutil.which('verilator') nao encontrado no runner.")
s = s.replace(wh_needle, wh_repl, 1)

open(p, "w", encoding="utf-8").write(s)
print("  runner patchado: LDFLAGS + fallback de resolucao do verilator.")
PY

# Instala o cocotb (com o runner patchado). O Verilator continua PULADO no
# build do setuptools (guard posix) — sem erro; geramos a VPI no passo 6.
say "Instalando o cocotb no venv..."
"$VPY" -m pip install --force-reinstall "$PKGDIR"

# ---- 5. Localiza libs_dir + includes --------------------------------------
python() { "$VPY" "$@"; }   # daqui pra baixo, 'python' = python do venv
LIBS="$(python -c 'import cocotb_tools.config as c; print(c.libs_dir)')"
PYINC="$(python -c 'import sysconfig; print(sysconfig.get_path("include"))')"
INC="$PKGDIR/src/cocotb/share/include"
VPIDIR="$PKGDIR/src/cocotb/share/lib/vpi"
# Includes do Verilator (pra o vpi_user.h ser o do verilator).
VROOT="$(verilator --getenv VERILATOR_ROOT 2>/dev/null || true)"
[ -n "$VROOT" ] || VROOT="$(dirname "$(command -v verilator)")/../share/verilator"
say "libs dir: $LIBS"
say "verilator root: $VROOT"

# ---- 6. Compila a libcocotbvpi_verilator.a (estatica) ---------------------
# Mesmas fontes/flags do build do icarus, trocando -DICARUS por -DVERILATOR.
# Estatica: deixa vpi_*/gpi/gpilog INDEFINIDOS — resolvem quando o exe verilado
# linka a .a (vpi_* do proprio verilator --vpi; gpi/gpilog dos DLLs core via os
# -l do runner). Sem -Werror pra nao quebrar por warning de versao nova do gcc.
# CHAVE: usar o vpi_user.h do VERILATOR (-I do VROOT) e -DPLI_DLLISPEC= pra que
# os vpi_* sejam PLANOS (sem __declspec(dllimport)); senao a .a referencia
# __imp_vpi_* que o verilated_vpi.o (que define vpi_* planos) nao satisfaz.
say "Compilando libcocotbvpi_verilator.a ..."
OBJ="$SRC/vpi_verilator_obj"; rm -rf "$OBJ"; mkdir -p "$OBJ"
for f in VpiImpl VpiCbHdl VpiObj VpiIterator VpiSignal; do
  g++ -O2 -std=c++11 -fvisibility=hidden -fvisibility-inlines-hidden \
      -DCOCOTBVPI_EXPORTS= -DVERILATOR= -D__STDC_FORMAT_MACROS= -DWIN32= -DPLI_DLLISPEC= \
      -I"$VROOT/include" -I"$VROOT/include/vltstd" \
      -I"$INC" -I"$PKGDIR/src/cocotb" -I"$PYINC" \
      -c "$VPIDIR/$f.cpp" -o "$OBJ/$f.o" || {
        echo "ERRO: falha compilando $f.cpp pra VPI do verilator." >&2; exit 1; }
done
ar rcs "$OBJ/libcocotbvpi_verilator.a" "$OBJ"/*.o
cp -f "$OBJ/libcocotbvpi_verilator.a" "$LIBS/"
say "Copiada pra $LIBS/libcocotbvpi_verilator.a"

# ---- 7. Verifica ----------------------------------------------------------
say "Verificando..."
echo "  conteudo de libs (vpi):"
ls -1 "$LIBS" | grep -iE 'cocotbvpi_(verilator|icarus)' | sed 's/^/    /' || true
if [ -f "$LIBS/libcocotbvpi_verilator.a" ]; then
  PREFIX="$(python -c 'import sys; print(sys.prefix)')"
  COCOTB_VER="$(python -c 'import cocotb; print(cocotb.__version__)')"
  say "PASS — libcocotbvpi_verilator.a presente. cocotb $COCOTB_VER"
  echo "  Python a empacotar (sys.prefix): $PREFIX"
  echo "  Proximo: smoke test de uma sim cocotb+verilator (get_runner('verilator'))."
else
  say "FAIL — libcocotbvpi_verilator.a NAO foi criada (veja o erro do g++ acima)."
  exit 1
fi
