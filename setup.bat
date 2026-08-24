@echo off
REM ===========================================================================
REM  setup.bat - prepara um PC Windows do zero para desenvolver a AURORA.
REM
REM  Passos, nesta ordem:
REM    1. local da copia (recusa pasta sincronizada, rede e caminho fundo)
REM    2. winget (vem com o Windows 10/11; e ele quem instala o resto)
REM    3. Git
REM    4. Node.js LTS (22.22.1 ou mais novo, o piso do package.json)
REM    5. VS Code (opcional, pergunta antes)
REM    6. dependencias do npm
REM    7. toolchain SAPHO (~1 GB na primeira vez; depois so o que faltar)
REM
REM  Pode dar duplo-clique neste arquivo ou rodar num terminal, inclusive no
REM  terminal integrado do VS Code. Rodar de novo e sempre seguro: cada passo
REM  detecta o que ja esta pronto e pula.
REM
REM  SOBRE ACENTOS: este arquivo e ASCII puro, de proposito. O console do
REM  Windows abre em varias paginas de codigo (437, 850, 65001) conforme a
REM  maquina e o idioma, e um texto acentuado escrito numa delas sai com
REM  simbolo trocado em todas as outras. Sem acento nenhum, a saida fica igual
REM  em qualquer terminal. Nao "corrija" a ortografia daqui.
REM ===========================================================================
setlocal EnableExtensions
pushd "%~dp0"
set "RAIZ=%CD%"

echo.
echo   ===========================================================
echo    AURORA - preparacao do ambiente de desenvolvimento
echo   ===========================================================
echo.

REM ---- [1/7] Local da copia -------------------------------------------------
REM  Uma pasta sincronizada na nuvem quebra este projeto de tres formas, e as
REM  tres aparecem tarde, longe da causa:
REM    - o sincronizador toca os arquivos o tempo todo, e a AURORA vigia a
REM      pasta do projeto: vira um ciclo de eventos que nao termina;
REM    - com "Arquivos sob Demanda", binarios da toolchain e do node_modules
REM      viram atalho para a nuvem e falham ao executar;
REM    - o sincronizador segura arquivo aberto, e a extracao da toolchain
REM      falha no meio, deixando a instalacao pela metade.
echo   [1/7] Local da copia
set "LOCALRUIM="
set "MOTIVO="

echo "%RAIZ%" | findstr /I /C:"OneDrive" >nul 2>nul
if not errorlevel 1 set "LOCALRUIM=1" & set "MOTIVO=OneDrive"
echo "%RAIZ%" | findstr /I /C:"Dropbox" >nul 2>nul
if not errorlevel 1 set "LOCALRUIM=1" & set "MOTIVO=Dropbox"
echo "%RAIZ%" | findstr /I /C:"Google Drive" >nul 2>nul
if not errorlevel 1 set "LOCALRUIM=1" & set "MOTIVO=Google Drive"
echo "%RAIZ%" | findstr /I /C:"GoogleDrive" >nul 2>nul
if not errorlevel 1 set "LOCALRUIM=1" & set "MOTIVO=Google Drive"
echo "%RAIZ%" | findstr /I /C:"iCloudDrive" >nul 2>nul
if not errorlevel 1 set "LOCALRUIM=1" & set "MOTIVO=iCloud Drive"
echo "%RAIZ%" | findstr /I /C:"Creative Cloud Files" >nul 2>nul
if not errorlevel 1 set "LOCALRUIM=1" & set "MOTIVO=Adobe Creative Cloud"

REM  Caminho de rede: a AURORA cria uma juncao de components/ dentro do
REM  node_modules do Electron, e juncao nao existe em compartilhamento de rede.
if "%RAIZ:~0,2%"=="\\" set "LOCALRUIM=1" & set "MOTIVO=pasta de rede (UNC)"

if defined LOCALRUIM goto :local_ruim
goto :local_ok

:local_ruim
if /I "%~1"=="--ignorar-local" (
  echo         [AVISO] %MOTIVO% detectado, seguindo porque voce pediu.
  goto :local_ok
)
echo.
echo         [PARE] Esta copia esta dentro de: %MOTIVO%
echo.
echo         %RAIZ%
echo.
echo         A AURORA nao funciona de forma confiavel daqui. O sincronizador
echo         mexe nos arquivos enquanto o aplicativo trabalha, e o resultado
echo         aparece como consumo de memoria que so sobe, toolchain que some
echo         sozinha, ou erro de arquivo em uso no meio da instalacao.
echo.
echo         O QUE FAZER: mova a pasta para um caminho local, fora da area
echo         sincronizada. Por exemplo:
echo.
echo             C:\Dev\aurora
echo.
echo         Feche o VS Code antes de mover, e rode este script de la.
echo.
echo         Se voce sabe o que esta fazendo e quer seguir assim mesmo:
echo             setup.bat --ignorar-local
echo.
goto :falha

:local_ok
REM  Caminho fundo: o node_modules aninha bastante e o Windows corta em 260
REM  caracteres. Aviso, nao impedimento.
set "FUNDO=%RAIZ:~90,1%"
if defined FUNDO (
  echo         [AVISO] caminho longo; se aparecer erro de arquivo nao
  echo                 encontrado, mova para algo curto como C:\Dev\aurora.
) else (
  if not defined LOCALRUIM echo         ok: %RAIZ%
)
echo.

REM ---- [2/7] winget ---------------------------------------------------------
echo   [2/7] winget
where winget >nul 2>nul
if errorlevel 1 (
  echo         [ERRO] winget nao encontrado.
  echo         Atualize o "Instalador de Aplicativo" pela Microsoft Store
  echo         e rode este script de novo.
  goto :falha
)
echo         ok
echo.

REM ---- [3/7] Git ------------------------------------------------------------
echo   [3/7] Git
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

REM ---- [4/7] Node.js --------------------------------------------------------
REM  Piso: 22.22.1 (package.json, campo engines). Aceita 22.x com minor maior
REM  ou igual a 22, ou qualquer major acima de 22. Conferir a versao de verdade
REM  importa: um Node antigo instala com aviso de engine e quebra bem depois,
REM  longe da causa.
echo   [4/7] Node.js
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

REM ---- [5/7] VS Code (opcional) ---------------------------------------------
REM  PERGUNTAS FICAM NA MARGEM, sem recuo, e isso e deliberado: tanto o /M do
REM  choice quanto o prompt do "set /p" descartam os espacos a esquerda, entao
REM  recuo em pergunta simplesmente nao existe no cmd. Em vez de meia solucao
REM  com truque de backspace, toda pergunta sai na coluna zero, precedida de
REM  uma linha em branco: fica consistente e separa o que e pergunta do que e
REM  relato. O /N esconde a lista "[S,N]" que o choice imprimiria sozinho,
REM  para a tecla digitada cair logo depois do "? " que escrevemos.
echo   [5/7] VS Code
where code >nul 2>nul
if errorlevel 1 (
  echo         nao encontrado.
  echo.
  <nul set /p "=Instalar o VS Code agora (S/N)? "
  choice /C SN /N /T 30 /D N
  if errorlevel 2 (
    echo.
    echo         pulado. Depois, se quiser:
    echo             winget install --id Microsoft.VisualStudioCode -e
  ) else (
    echo.
    winget install --id Microsoft.VisualStudioCode -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 echo         [AVISO] a instalacao do VS Code falhou; siga sem ele.
  )
) else (
  echo         ok
)
REM  Zera o errorlevel antes de seguir. O choice acima devolve 2 quando a
REM  resposta e "nao", e no cmd o errorlevel NAO se limpa sozinho: echo e
REM  set nao mexem nele. Sem esta linha, um passo seguinte cujo comando nao
REM  defina errorlevel proprio herdaria o 2 e seria lido como falha. Hoje o
REM  npm sempre define o seu, entao nao ha bug vivo; isto fecha a classe.
ver >nul
echo.

REM ---- [6/7] dependencias do npm --------------------------------------------
echo   [6/7] Dependencias do npm
echo         rodando npm install...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo         [ERRO] npm install falhou. A causa esta nas mensagens acima.
  goto :falha
)
echo         ok
echo.

REM ---- [7/7] toolchain SAPHO ------------------------------------------------
echo   [7/7] Toolchain SAPHO
echo         primeira vez baixa cerca de 1 GB; depois so o que faltar.
call npm run bootstrap
if errorlevel 1 (
  echo         [ERRO] o bootstrap falhou. Atras de proxy corporativo, o script
  echo         imprime a URL que tentou, para baixar pelo navegador e extrair
  echo         na mao. Se o antivirus estiver apagando o que foi extraido,
  echo         libere a pasta components\ e rode de novo.
  goto :falha
)
echo         ok
echo.

echo   ===========================================================
echo    Tudo pronto. Proximos passos:
echo.
echo      abrir a pasta no VS Code ....  code .
echo      rodar a AURORA ..............  npm start
echo      rodar com hot-reload ........  npm run dev
echo   ===========================================================
echo.
<nul set /p "=Iniciar a AURORA agora (S/N)? "
choice /C SN /N /T 30 /D N
if errorlevel 2 goto :fim
echo.
popd
call npm start
exit /b 0

:fim
echo.
popd
exit /b 0

:falha
echo.
popd
pause
exit /b 1
