// @ts-check
/**
 * Roda a suite E2E varias vezes e diz QUAIS casos falharam, em quantas.
 *
 * Existe por uma regra simples: teste vermelho nao se aceita. Para cumprir a
 * regra e preciso saber QUAL caso ficou vermelho, e uma suite que sobe um
 * Electron de verdade falha de vez em quando por razao de ambiente, nao de
 * codigo. As duas coisas se parecem na hora, e se parecem ainda mais quando a
 * saida do terminal ja rolou.
 *
 * O que este script resolve: cada corrida grava o resultado em
 * `reports/e2e-last-run.json` (ver vitest.config.e2e.js), e aqui esse arquivo
 * e lido e acumulado. No fim sai uma tabela com um caso por linha e em quantas
 * corridas ele falhou. Falhou em todas, e o codigo. Falhou em uma de dez, e
 * instabilidade, e ai da para ir atras dela pelo nome em vez de pelo palpite.
 *
 * Uso:
 *   node scripts/e2e-repete.js [n]      (n corridas, 3 por padrao)
 *
 * Sai com codigo 1 se QUALQUER corrida teve falha, para nao passar batido.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const RELATORIO = path.join(RAIZ, 'reports', 'e2e-last-run.json');

/** As falhas de uma corrida, pelo nome completo do caso. */
function falhasDaCorrida() {
  if (!fs.existsSync(RELATORIO)) return ['(a corrida nao deixou relatorio)'];
  let d;
  try {
    d = JSON.parse(fs.readFileSync(RELATORIO, 'utf8'));
  } catch (_) {
    return ['(relatorio ilegivel)'];
  }
  const fora = [];
  for (const arquivo of d.testResults || []) {
    for (const caso of arquivo.assertionResults || []) {
      if (caso.status !== 'passed' && caso.status !== 'pending') {
        fora.push(caso.fullName || caso.title || '(sem nome)');
      }
    }
  }
  return fora;
}

function main() {
  const vezes = Math.max(1, Number(process.argv[2]) || 3);
  /** @type {Map<string, number>} */
  const placar = new Map();
  let corridasVermelhas = 0;

  for (let i = 1; i <= vezes; i++) {
    try { fs.rmSync(RELATORIO, { force: true }); } catch (_) { /* nao existia */ }
    const r = spawnSync('npm', ['run', 'test:e2e'], {
      cwd: RAIZ, shell: true, stdio: 'ignore',
    });
    const falhas = r.status === 0 ? [] : falhasDaCorrida();
    if (falhas.length) corridasVermelhas += 1;
    for (const f of falhas) placar.set(f, (placar.get(f) || 0) + 1);
    const marca = falhas.length ? `VERMELHA (${falhas.length})` : 'verde';
    console.log(`corrida ${i}/${vezes}: ${marca}`);
    for (const f of falhas) console.log(`    ${f}`);
  }

  console.log(`\n${vezes} corrida(s), ${corridasVermelhas} vermelha(s).`);
  if (!placar.size) {
    console.log('Nenhum caso falhou.');
    return 0;
  }
  console.log('\ncaso                                                          falhou em');
  for (const [nome, n] of [...placar].sort((a, b) => b[1] - a[1])) {
    const corte = nome.length > 58 ? `${nome.slice(0, 57)}…` : nome.padEnd(58);
    console.log(`${corte}  ${n}/${vezes}`);
  }
  console.log('\nFalhou em TODAS: e o codigo. Falhou em algumas: e instabilidade,');
  console.log('e agora ela tem nome.');
  return 1;
}

process.exit(main());
