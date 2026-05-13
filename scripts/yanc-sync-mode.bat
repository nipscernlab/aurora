@echo off
:: ============================================================================
:: yanc-sync-mode.bat
::
:: Reativa o tracking dos arquivos do yanc no Aurora. Use quando quiser
:: commitar uma sincronizacao da versao "oficial" desses arquivos (ex: o yanc
:: estabilizou uma mudanca e voce quer que ela vire a versao de referencia
:: no Aurora).
::
:: Fluxo tipico:
::   1. scripts\yanc-sync-mode.bat
::   2. git add components\... (revisar antes!)
::   3. git commit -m "sync: ..."
::   4. scripts\yanc-test-mode.bat  ^(volta pro modo silencioso^)
:: ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0.."

set COUNT=0
for /f "usebackq delims=" %%F in ("scripts\yanc-managed-files.txt") do (
    git update-index --no-skip-worktree "%%F"
    if errorlevel 1 (
        echo [WARN] Falhou em: %%F
    ) else (
        set /a COUNT+=1
    )
)

echo.
echo [yanc-sync-mode] OK - !COUNT! arquivos com tracking reativado.
echo git status agora mostra de novo mudancas locais neles.
echo.
echo Quando terminar de commitar, rode: scripts\yanc-test-mode.bat
endlocal
