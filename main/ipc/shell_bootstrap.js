// @ts-check
/**
 * shell_bootstrap.js: o que o terminal TCMD monta ANTES de o PowerShell subir.
 *
 * Isto saiu de dentro do `shell.js` porque é a parte que dá para provar sem
 * abrir um pseudo-terminal: montar texto de script, escapar aspas, codificar
 * para `-EncodedCommand` e domar as dimensões da grade. O `shell.js` continua
 * dono do PTY, das sessões e do IPC; aqui não há efeito nenhum.
 *
 * O QUE ESTÁ EM JOGO
 *
 * O bootstrap é lido pelo PowerShell como UM comando codificado, e ele roda no
 * shell do usuário. Uma aspa mal escapada não dá erro de sintaxe visível: ela
 * termina a string mais cedo e o resto da linha vira comando. Como o caminho
 * que entra ali é o do Python empacotado, e pasta de usuário aceita aspa
 * simples no Windows, isso é alcançável por acidente antes de ser alcançável
 * por má intenção.
 *
 * E a codificação é a segunda armadilha: `-EncodedCommand` exige UTF-16LE em
 * base64. Mandar UTF-8 não falha alto, produz mojibake ou um comando vazio, e o
 * sintoma que chega ao usuário é o prompt da AURORA simplesmente não aparecer.
 */

'use strict';

/** Grade mínima. Abaixo disto o ConPTY se recusa a alocar buffer. */
const MIN_GRID = 2;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Escapa para dentro de uma string literal de PowerShell (aspas simples).
 * A regra do PowerShell é duplicar a aspa, não usar barra invertida.
 * @param {string} s
 */
function psQuote(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Trecho que ensina a sessão a alcançar o Python da AURORA.
 *
 * O PROBLEMA QUE ELE RESOLVE SEM CRIAR OUTRO
 *
 * O TCMD é um shell de verdade: `python` ali significa o Python que o usuário
 * instalou, com os pacotes que ele instalou por pip. Isso é desejável e não
 * pode ser tomado dele.
 *
 * A tentação seria exportar PYTHONPATH apontando para o nosso PyLibs. Seria
 * errado: essa variável é lida por QUALQUER python que rode no terminal,
 * inclusive o do usuário, e as nossas bibliotecas passariam a se misturar com
 * as dele. É exatamente a colisão a evitar.
 *
 * Aqui não se toca em PATH nem em PYTHONPATH. Define-se `apython`, que invoca
 * sempre o interpretador embarcado, e `Use-Python aurora|system`, que troca o
 * significado de `python` NESTA sessão definindo ou removendo uma função com
 * esse nome (função tem precedência sobre executável do PATH em PowerShell). O
 * padrão é `system`: o terminal começa sendo o shell que o usuário espera.
 *
 * @param {string} exe caminho do python.exe embarcado ('' se o bundle não existe)
 * @returns {string} vazio quando não há bundle, o chamador simplesmente não injeta nada
 */
function pythonBridgeScript(exe) {
  if (!exe) return '';
  return `
$env:AURORA_PYTHON_EXE = '${psQuote(exe)}'
function apython { & $env:AURORA_PYTHON_EXE @args }
# A deteccao usa Get-Command -CommandType Function, e a remocao usa
# 'function:python' SEM o prefixo global: e COM -Force. Medido na pratica:
# 'Remove-Item function:global:python' nao remove nada (e Test-Path continua
# dizendo que existe), o que fazia 'Use-Python system' anunciar a troca sem
# efetua-la, o pior tipo de defeito, porque mente para o usuario.
function Test-AuroraPythonActive {
  [bool](Get-Command python -CommandType Function -ErrorAction SilentlyContinue)
}
function Use-Python {
  param([ValidateSet('aurora','system','')] [string] $Which = '')
  if ($Which -eq 'aurora') {
    Set-Item -Path function:global:python -Value { & $env:AURORA_PYTHON_EXE @args }
    Write-Host 'python -> AURORA (bibliotecas do painel disponiveis)' -ForegroundColor Cyan
  } elseif ($Which -eq 'system') {
    if (Test-AuroraPythonActive) { Remove-Item -LiteralPath 'function:python' -Force }
    Write-Host 'python -> o do sistema (suas bibliotecas do pip)' -ForegroundColor Cyan
  } else {
    if (Test-AuroraPythonActive) { Write-Host 'python -> AURORA' }
    else { Write-Host 'python -> o do sistema' }
    Write-Host 'troque com: Use-Python aurora | Use-Python system' -ForegroundColor DarkGray
    Write-Host 'ou chame o da AURORA direto com: apython script.py' -ForegroundColor DarkGray
  }
}
`.trim();
}

/**
 * Linha que carrega o prompt da AURORA NESTA sessão.
 *
 * Ela lê o `.ps1` como TEXTO e o executa como scriptblock, em vez de mandar o
 * PowerShell rodar o arquivo. São duas consequências, e as duas são o motivo de
 * a linha existir assim: o `$PROFILE` do usuário fica intocado, e a política de
 * execução para ARQUIVO de script não se aplica, então máquina em Restricted ou
 * RemoteSigned também ganha o prompt.
 *
 * @param {string} scriptPath
 */
function promptBootstrapLine(scriptPath) {
  const p = psQuote(scriptPath);
  return `$p = '${p}'; if (Test-Path -LiteralPath $p) { . ([ScriptBlock]::Create((Get-Content -Raw -LiteralPath $p))) }`;
}

/**
 * Junta os trechos e codifica para `-EncodedCommand`.
 *
 * UTF-16LE é exigência do PowerShell, não escolha. Trechos vazios saem fora
 * para não deixar linha em branco solta no meio do comando codificado.
 *
 * @param {string[]} parts
 * @returns {string} base64, ou '' quando não há nada a injetar
 */
function encodeBootstrap(parts) {
  const uteis = (parts || []).filter((p) => typeof p === 'string' && p.trim() !== '');
  if (uteis.length === 0) return '';
  return Buffer.from(uteis.join('\n'), 'utf16le').toString('base64');
}

/**
 * Dimensão de terminal vinda do renderer, domada.
 *
 * Havia duas regras diferentes para a mesma coisa: o `shell:start` usava
 * `Number.isFinite(x) ? max(2, x|0) : 80` e o `shell:resize` usava
 * `max(2, (x|0) || 80)`. Para 0 uma devolvia 2 e a outra 80, o que significa
 * que iniciar e redimensionar com o mesmo valor davam terminais diferentes.
 * Aqui a regra é uma só: valor não utilizável cai no padrão, e valor utilizável
 * é truncado com piso, porque abaixo do piso o ConPTY não aloca.
 *
 * @param {{cols?: any, rows?: any}} [entrada]
 * @returns {{cols: number, rows: number}}
 */
function clampGrid(entrada) {
  const um = (valor, padrao) => {
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) return padrao;
    return Math.max(MIN_GRID, Math.trunc(n));
  };
  return {
    cols: um(entrada && entrada.cols, DEFAULT_COLS),
    rows: um(entrada && entrada.rows, DEFAULT_ROWS),
  };
}

module.exports = {
  psQuote,
  pythonBridgeScript,
  promptBootstrapLine,
  encodeBootstrap,
  clampGrid,
  MIN_GRID,
  DEFAULT_COLS,
  DEFAULT_ROWS,
};
