// @ts-check
/**
 * sac_status.js: descobre se o Smart App Control esta bloqueando a toolchain.
 *
 * Relato #6 (sapho-relatos): num Windows 11 com Smart App Control ativo, os
 * binarios sem assinatura da cadeia de simulacao (vvp, ivl, gtkwave) sao
 * barrados na hora do spawn, e o aluno so descobre pelo "spawn UNKNOWN" no
 * meio de uma compilacao, tarde e sem contexto. O SAC nao tem excecao por
 * pasta nem por aplicativo: enquanto estiver em modo de bloqueio, simular
 * simplesmente nao funciona.
 *
 * O estado mora no registro, em HKLM\SYSTEM\CurrentControlSet\Control\CI\
 * Policy, valor VerifiedAndReputablePolicyState: 1 e bloqueio, 2 e avaliacao
 * (nao bloqueia, so observa), 0 e desligado. Maquina sem o valor (Windows 10,
 * builds antigas) nao tem SAC. A leitura e por `reg query`, sem privilegios.
 *
 * O renderer pergunta uma vez no boot ('sac:estado') e avisa com toast quando
 * o estado e 'ligado'. Avisar toda abertura e deliberado: enquanto o SAC
 * bloqueia, a simulacao esta quebrada de verdade, e um aviso que se cala
 * ensina a esquecer o problema.
 */

'use strict';

const { execFile } = require('child_process');
const { ipcMain } = require('electron');
const log = require('electron-log');

const CHAVE = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy';
const VALOR = 'VerifiedAndReputablePolicyState';

/**
 * Interpreta a saida do `reg query` para o estado do SAC.
 *
 * Exportada para o teste: e a unica parte com logica, e errar aqui vira ou
 * um falso alarme em toda maquina ou um silencio na maquina do aluno.
 *
 * @param {string} saida  stdout do reg query
 * @returns {'ligado'|'avaliacao'|'desligado'|'desconhecido'}
 */
function interpretarPolicyState(saida) {
  const m = /VerifiedAndReputablePolicyState\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(String(saida || ''));
  if (!m) return 'desconhecido';
  const v = parseInt(m[1], 16);
  if (v === 1) return 'ligado';
  if (v === 2) return 'avaliacao';
  if (v === 0) return 'desligado';
  return 'desconhecido';
}

/**
 * Le o estado atual. Fora do Windows, ou sem o valor no registro, responde
 * 'desligado'/'desconhecido' e ninguem e incomodado.
 *
 * @returns {Promise<'ligado'|'avaliacao'|'desligado'|'desconhecido'>}
 */
function estadoSmartAppControl() {
  if (process.platform !== 'win32') return Promise.resolve('desligado');
  return new Promise((resolve) => {
    execFile('reg', ['query', CHAVE, '/v', VALOR], { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) { resolve('desconhecido'); return; }
        resolve(interpretarPolicyState(stdout));
      });
  });
}

function register() {
  ipcMain.handle('sac:estado', async () => {
    const estado = await estadoSmartAppControl();
    if (estado === 'ligado') {
      log.warn('[sac] Smart App Control em modo de bloqueio: a toolchain sem assinatura nao vai rodar');
    }
    return { estado };
  });
}

module.exports = { register, estadoSmartAppControl, interpretarPolicyState };
