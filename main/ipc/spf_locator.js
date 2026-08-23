// @ts-check
/**
 * spf_locator.js: a varredura que reencontra um `.spf` que sumiu dos recentes.
 *
 * UMA varredura para vários alvos ao mesmo tempo: o usuário que perdeu uma
 * pasta costuma ter perdido várias (moveu o diretório de projetos inteiro), e
 * varrer o disco uma vez por projeto multiplicaria o custo pelo número deles.
 * Pedir a localização de mais projetos com a varredura viva só ACRESCENTA
 * alvos a ela; cada achado sai na hora por evento, sem esperar o resto.
 *
 * É busca em largura a partir das raízes prováveis (Desktop, Documentos,
 * Downloads, o perfil, depois cada disco), com as decisões de rota em
 * spf_locator_rules.js, onde têm teste. Guarda-corpos: profundidade máxima,
 * teto de diretórios visitados, links simbólicos ignorados (ciclo de junção
 * no Windows), e cancelamento a qualquer momento. Nada disso é erro: a
 * varredura termina dizendo o que achou e o que não achou.
 */

'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');
const log = require('electron-log');

const { dirEntra, ordenarRaizes, melhorAlvo } = require('./spf_locator_rules');

const PROFUNDIDADE_MAX = 16;
const DIRETORIOS_MAX = 500_000;
/** De quantos em quantos diretorios o renderer ouve o progresso. */
const PASSO_PROGRESSO = 1500;

/**
 * O estado da varredura corrente, uma por vez por desenho: os alvos são um
 * mapa e novos pedidos entram nele.
 * @type {{
 *   alvos: Map<string, string>,
 *   cancelada: boolean,
 *   rodando: boolean,
 *   sender: import('electron').WebContents | null,
 * }}
 */
const estado = { alvos: new Map(), cancelada: false, rodando: false, sender: null };

function avisar(canal, carga) {
  try {
    if (estado.sender && !estado.sender.isDestroyed()) estado.sender.send(canal, carga);
  } catch (_e) { /* janela fechou no meio */ }
}

/** As raízes de disco que existem agora (C:\, D:\, ...). */
async function raizesDeDisco() {
  const letras = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const existentes = [];
  await Promise.all(letras.map(async (l) => {
    try { await fs.stat(`${l}:\\`); existentes.push(`${l}:\\`); } catch (_e) { /* sem esse disco */ }
  }));
  return existentes.sort();
}

/** Basenames (minúsculos) que ainda procuramos → chaves que os querem. */
function porBasename() {
  const idx = new Map();
  for (const [chave, base] of estado.alvos) {
    const k = base.toLowerCase();
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(chave);
  }
  return idx;
}

async function varrer() {
  estado.rodando = true;
  let visitados = 0;
  try {
    const raizes = ordenarRaizes(os.homedir(), await raizesDeDisco());
    /** @type {Array<{dir: string, prof: number}>} */
    const fila = raizes.map((dir) => ({ dir, prof: 0 }));
    const vistos = new Set();

    while (fila.length && estado.alvos.size && !estado.cancelada && visitados < DIRETORIOS_MAX) {
      const { dir, prof } = /** @type {{dir: string, prof: number}} */ (fila.shift());
      const chaveDir = dir.toLowerCase();
      if (vistos.has(chaveDir)) continue;
      vistos.add(chaveDir);
      visitados++;
      if (visitados % PASSO_PROGRESSO === 0) {
        avisar('recents:locate-progress', { scanned: visitados, targetsLeft: estado.alvos.size });
      }

      let handle;
      try { handle = await fs.opendir(dir); }
      catch (_e) { continue; }               // sem permissao, sumiu, etc.
      try {
        const indice = porBasename();
        for await (const entrada of handle) {
          if (estado.cancelada || !estado.alvos.size) break;
          // Links e juncoes criam ciclos (Documents and Settings -> Users);
          // pular e mais barato que resolver o alvo de cada um.
          if (entrada.isSymbolicLink()) continue;
          if (entrada.isDirectory()) {
            if (prof < PROFUNDIDADE_MAX && dirEntra(entrada.name)) {
              fila.push({ dir: path.join(dir, entrada.name), prof: prof + 1 });
            }
            continue;
          }
          if (!entrada.name.toLowerCase().endsWith('.spf')) continue;
          const chaves = indice.get(entrada.name.toLowerCase());
          if (!chaves || !chaves.length) continue;
          const achado = path.join(dir, entrada.name);
          const vencedora = melhorAlvo(chaves.filter((c) => estado.alvos.has(c)), achado);
          if (!vencedora) continue;
          estado.alvos.delete(vencedora);
          avisar('recents:locate-found', { key: vencedora, path: achado });
        }
      } catch (_e) { /* leitura interrompida: segue para o proximo dir */ }
      finally {
        // opendir com for-await fecha sozinho no fim normal; fechar de novo
        // apos um break e inofensivo e cobre a saida antecipada.
        try { await handle.close(); } catch (_e) { /* ja fechado */ }
      }
    }

    avisar('recents:locate-done', {
      scanned: visitados,
      remaining: [...estado.alvos.keys()],
    });
  } catch (e) {
    log.warn('[spf_locator] varredura falhou:', e);
    avisar('recents:locate-done', { scanned: visitados, remaining: [...estado.alvos.keys()] });
  } finally {
    estado.rodando = false;
    estado.alvos.clear();
    estado.cancelada = false;
  }
}

function register() {
  /**
   * Começa (ou reforça) a varredura. `targets` = [{ key, basename }], onde
   * `key` é o caminho antigo, que é como o renderer identifica a entrada.
   */
  ipcMain.handle('recents:locate-start', (event, targets) => {
    const lista = Array.isArray(targets) ? targets : [];
    for (const t of lista) {
      const chave = t && typeof t.key === 'string' ? t.key : null;
      const base = t && typeof t.basename === 'string' ? t.basename : null;
      if (chave && base && base.toLowerCase().endsWith('.spf')) estado.alvos.set(chave, base);
    }
    estado.sender = event.sender;
    if (!estado.alvos.size) return { ok: false, error: 'nenhum alvo valido' };
    if (!estado.rodando) {
      estado.cancelada = false;
      varrer();                              // roda solta; o resultado sai por evento
    }
    return { ok: true, running: true, targets: estado.alvos.size };
  });

  ipcMain.handle('recents:locate-cancel', () => {
    estado.cancelada = true;
    return { ok: true };
  });

  log.info('[ipc.spf_locator] handlers registered');
}

module.exports = { register };
