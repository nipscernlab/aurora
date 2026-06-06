#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
# Script vive em scripts/; a raiz do projeto e' o diretorio-pai.
$root = Split-Path $PSScriptRoot -Parent

# ── helpers ───────────────────────────────────────────────────────────────────

function Write-Header {
    param([string]$Text)
    $line = '=' * 50
    Write-Host ""
    Write-Host $line -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host $line -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Text)
    Write-Host ""
    Write-Host ('-' * 50) -ForegroundColor DarkGray
    Write-Host "  $Text" -ForegroundColor White
    Write-Host ('-' * 50) -ForegroundColor DarkGray
    Write-Host ""
}

function Update-FileVersion {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Replacement,
        [string]$Label
    )
    if (-not (Test-Path $Path)) {
        Write-Host "  [AVISO] Nao encontrado: $Path" -ForegroundColor Yellow
        return
    }
    $content = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $updated = $content -replace $Pattern, $Replacement
    if ($content -eq $updated) {
        Write-Host "  [AVISO] Sem alteracao em: $Label" -ForegroundColor Yellow
    } else {
        [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
        Write-Host "  [OK] $Label" -ForegroundColor Green
    }
}

# ── lê versão atual ───────────────────────────────────────────────────────────

Write-Header "SAPHO / Aurora IDE -- Build Script"

$pkgPath = Join-Path $root 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$currentVer = $pkg.version

Write-Host "  Versao atual : $currentVer" -ForegroundColor White

# ── pede nova versão ──────────────────────────────────────────────────────────

do {
    $newVer = (Read-Host "  Nova versao  (ex: 5.1.0)").Trim()
    if ($newVer -notmatch '^\d+\.\d+\.\d+$') {
        Write-Host "  [ERRO] Formato invalido. Use X.Y.Z  (ex: 5.1.0)" -ForegroundColor Red
    }
} while ($newVer -notmatch '^\d+\.\d+\.\d+$')

# ── monta replacement ─────────────────────────────────────────────────────────
# ${1} e ${2} sao backreferences do regex; devem chegar como string literal
# a funcao Update-FileVersion. Por isso sao construidos em variaveis separadas.

$g1 = '${1}'   # grupo capturado antes da versao
$g2 = '${2}'   # grupo capturado depois da versao
$repl = $g1 + $newVer + $g2

$old = [Regex]::Escape($currentVer)

# ── atualiza arquivos ─────────────────────────────────────────────────────────

Write-Step "Atualizando versao  $currentVer  ->  $newVer"

Update-FileVersion (Join-Path $root 'package.json') `
           "(`"version`"\s*:\s*`")$old(`")" `
           $repl `
           'package.json -- version'

Update-FileVersion (Join-Path $root 'index.html') `
           "(footer-version`">v)$old(<\/)" `
           $repl `
           'index.html -- footer-version'

Update-FileVersion (Join-Path $root '.release-please-manifest.json') `
           "(`"\.`"\s*:\s*`")$old(`")" `
           $repl `
           '.release-please-manifest.json'

Update-FileVersion (Join-Path $root '.github\ISSUE_TEMPLATE\bug_report.yml') `
           "(placeholder:\s*`")$old(`")" `
           $repl `
           'bug_report.yml -- placeholder'

# ── sync das regras do yanc ───────────────────────────────────────────────────
# Regenera resources/sapho_rules.json a partir do checkout local do yanc
# (default C:\Users\LCOM\Documents\Github\yanc; override por $env:YANC_PATH).
# Não bloqueia o build se o yanc não estiver presente — o JSON existente
# continua válido.

Write-Step "Sincronizando regras do yanc..."

Set-Location $root
$rulesProc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run rules:sync' `
    -NoNewWindow -Wait -PassThru

if ($rulesProc.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "  [AVISO] rules:sync falhou (exit $($rulesProc.ExitCode))." -ForegroundColor Yellow
    Write-Host "          O sapho_rules.json existente sera usado." -ForegroundColor Yellow
    Write-Host "          Configure `$env:YANC_PATH se o yanc estiver em outro path." -ForegroundColor Yellow
    Write-Host ""
}

# ── build ─────────────────────────────────────────────────────────────────────

Write-Step "Iniciando build..."

Set-Location $root
$proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run build' `
    -NoNewWindow -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Host ""
    Write-Host "  [ERRO] Build falhou (exit code $($proc.ExitCode))." -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ── resultado ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host ('=' * 50) -ForegroundColor Green
Write-Host "  Build concluido com sucesso!" -ForegroundColor Green
Write-Host "  Versao : v$newVer" -ForegroundColor Green
Write-Host "  Output : $(Join-Path $root 'dist')" -ForegroundColor Green
Write-Host ('=' * 50) -ForegroundColor Green
Write-Host ""
