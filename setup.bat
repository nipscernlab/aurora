@echo off
REM ===========================================================================
REM  setup.bat - prepara um PC Windows do zero para desenvolver a AURORA.
REM
REM  O que ele garante, nesta ordem:
REM    1. winget disponivel (vem com o Windows 10/11; e ele quem instala o resto)
REM    2. Git instalado
REM    3. Node.js LTS instalado (versao 22.22.1 ou mais nova)
REM    4. VS Code instalado (opcional, pergunta antes)
REM    5. dependencias do npm instaladas (npm install)
REM    6. toolchain SAPHO baixada (npm run bootstrap; ~1 GB na primeira vez,
REM       execucoes seguintes pulam o que ja existe)
REM
REM  Pode dar duplo-clique neste arquivo ou rodar num terminal, inclusive no
REM  terminal integrado do VS Code. Rodar de novo e sempre seguro: cada passo
REM  detecta o que ja esta pronto e pula.
REM ===========================================================================
setlocal EnableExtensions
pushd "%~dp0"

echo.
echo   =========================================================
echo    AURORA - preparacao do ambiente de desenvolvimento
echo   =========================================================
echo.

REM ---- [1/6] winget ---------------------------------------------------------
echo   [1/6] winget
where winget >nul 2>nul
if errorlevel 1 (
  echo         [ERRO] winget nao encontrado.
  echo         Atualize o "Instalador de Aplicativo" pela Microsoft Store
  echo         e rode este script de novo.
  goto :falha
)
echo         ok
echo.

REM ---- [2/6] Git ------------------------------------------------------------
echo   [2/6] Git
where git >nul 2>nul
if errorlevel 1 (
  echo         instalando via winget...
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo         [ERRO] a instalacao do Git falhou.
    goto :falha
  )
  set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
  where git >nul 2>nul
  if errorlevel 1 (
    echo         [ERRO] Git instalado mas ainda fora do PATH.
    echo         Feche e reabra o terminal e rode o script de novo.
    goto :falha
  )
)
for /f "delims=" %%v in ('git --version') do echo         ok: %%v
echo.

REM ---- [3/6] Node.js --------------------------------------------------------
REM  Piso: 22.22.1 (package.json engines). Aceita 22.x com minor maior ou
REM  igual a 22, ou qualquer major acima de 22.
echo   [3/6] Node.js
set "NODE_OK="
where node >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=1,2 delims=v." %%a in ('node --version') do (
    if %%a GTR 22 set "NODE_OK=1"
    if %%a EQU 22 if %%b GEQ 22 set "NODE_OK=1"
  )
)
if not defined NODE_OK (
  echo         instalando Node.js LTS via winget...
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo         [ERRO] a instalacao do Node.js falhou.
    goto :falha
  )
  set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
  where node >nul 2>nul
  if errorlevel 1 (
    echo         [ERRO] Node.js instalado mas ainda fora do PATH.
    echo         Feche e reabra o terminal e rode o script de novo.
    goto :falha
  )
)
for /f "delims=" %%v in ('node --version') do echo         ok: Node %%v
echo.

REM ---- [4/6] VS Code (opcional) ---------------------------------------------
echo   [4/6] VS Code
where code >nul 2>nul
if errorlevel 1 (
  choice /C SN /T 30 /D N /M "        nao encontrado. Instalar o VS Code agora"
  if errorlevel 2 (
    echo         pulado. Pode instalar depois: winget install Microsoft.VisualStudioCode
  ) else (
    winget install --id Microsoft.VisualStudioCode -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 echo         [AVISO] a instalacao do VS Code falhou; siga sem ele.
  )
) else (
  echo         ok
)
echo.

REM ---- [5/6] dependencias do npm --------------------------------------------
echo   [5/6] dependencias do npm (npm install)
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo         [ERRO] npm install falhou. Veja as mensagens acima.
  goto :falha
)
echo         ok
echo.

REM ---- [6/6] toolchain SAPHO ------------------------------------------------
echo   [6/6] toolchain SAPHO (npm run bootstrap)
echo         primeira vez baixa ~1 GB; depois so completa o que faltar.
call npm run bootstrap
if errorlevel 1 (
  echo         [ERRO] o bootstrap falhou. Atras de proxy corporativo, o
  echo         script imprime a URL tentada para baixar no navegador.
  goto :falha
)
echo         ok
echo.

echo   =========================================================
echo    Tudo pronto. Proximos passos:
echo.
echo      abrir a pasta no VS Code .... code .
echo      rodar a AURORA .............. npm start
echo      rodar com hot-reload ........ npm run dev
echo   =========================================================
echo.
choice /C SN /T 30 /D N /M "  Iniciar a AURORA agora"
if %errorlevel%==1 (
  popd
  call npm start
  exit /b 0
)
popd
exit /b 0

:falha
echo.
popd
pause
exit /b 1
