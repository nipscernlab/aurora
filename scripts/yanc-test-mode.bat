@echo off
:: ============================================================================
:: yanc-test-mode.bat
::
:: Silencia mudancas locais nos arquivos do Aurora que o build.bat do yanc
:: sobrescreve. Roda uma vez; daqui em diante, `git status` fica limpo mesmo
:: depois de rodar o build no yanc.
::
:: Pra reativar (quando quiser commitar uma sync com o yanc), rode:
::   scripts\yanc-sync-mode.bat
:: ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0.."

set COUNT=0
for /f "usebackq delims=" %%F in ("scripts\yanc-managed-files.txt") do (
    git update-index --skip-worktree "%%F"
    if errorlevel 1 (
        echo [WARN] Falhou em: %%F  ^(arquivo pode ter sido removido ou renomeado^)
    ) else (
        set /a COUNT+=1
    )
)

echo.
echo [yanc-test-mode] OK - !COUNT! arquivos silenciados.
echo git agora ignora mudancas locais neles.
echo.
echo Pra reativar: scripts\yanc-sync-mode.bat
endlocal
