@echo off
REM ===========================================================================
REM  verify-components.bat - "Doctor" dos componentes da AURORA (Windows)
REM
REM  Verifica os executaveis instalados em components/ (verilator, YANC,
REM  gtkwave, surfer, verible, slang, clang-format) e, para o que estiver
REM  faltando ou desatualizado, oferece re-baixar dos releases da AURORA.
REM
REM  Pode dar duplo-clique neste arquivo. Repassa qualquer argumento pro
REM  script Node (ex.: verify-components.bat --report  /  --yes  /  --force-all).
REM ===========================================================================
setlocal

REM Raiz do repo = pasta-pai deste .bat (scripts\)
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERRO] Node.js nao encontrado no PATH.
  echo   Instale o Node.js ^(>=18^) e tente de novo: https://nodejs.org
  echo.
  popd
  pause
  exit /b 1
)

node "scripts\verify-components.js" %*
set "RC=%ERRORLEVEL%"

popd

REM Pausa so quando rodou por duplo-clique (sem args), pra janela nao sumir.
if "%~1"=="" pause
exit /b %RC%
