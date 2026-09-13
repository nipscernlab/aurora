/**
 * Pontos de restauracao e rewind do projeto: main/ipc/history.js.
 *
 * Um ponto e um INSTANTE, e nao uma copia do projeto. Quem guarda conteudo e o
 * historico por arquivo, que ja grava toda gravacao; o ponto registra quando
 * foi, e voltar a ele e devolver cada arquivo a versao mais recente daquele
 * instante ou antes. E por isso que um ponto custa quase nada e da para marcar
 * um a cada mensagem da IA e a cada compilacao.
 *
 * Ha um buraco nessa ideia, e e ele que obriga o ponto a varrer as fontes ao
 * ser criado: um arquivo que nunca foi salvo pela AURORA nao tem versao
 * nenhuma, e a captura preguicosa do `write-file` so o guardaria no momento em
 * que a IA fosse sobrescreve-lo, ja com carimbo POSTERIOR ao ponto. Voltar nao
 * acharia nada para esse arquivo justamente quando ele e o que se quer de
 * volta. O primeiro teste daqui e esse caso.
 *
 * Arquivo criado depois do ponto vai para a LIXEIRA, e nao para o unlink:
 * voltar ja e uma acao grande, e apagar de vez o que a IA criou trocaria um
 * arrependimento por outro.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const hist = require('../../main/ipc/history.js');

let raiz;
const arq = (rel) => path.join(raiz, rel.split('/').join(path.sep));
const escrever = (rel, texto) => {
  const p = arq(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texto, 'utf8');
  return p;
};
const ler = (rel) => fs.readFileSync(arq(rel), 'utf8');

beforeEach(() => { raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-ponto-')); });
afterEach(() => { try { fs.rmSync(raiz, { recursive: true, force: true }); } catch { /* ja foi */ } });

describe('ponto: a varredura que fecha o buraco', () => {
  it('garante uma versao para arquivo que nunca foi salvo pela AURORA', () => {
    // O caso real: o projeto ja existia no disco antes de o historico existir.
    escrever('Hardware/top.v', 'ORIGINAL\n');
    escrever('Software/proc.cmm', 'void main(){}\n');

    const p = hist.criarPonto(raiz, { rotulo: 'antes do pedido' });

    expect(p.ok).toBe(true);
    expect(p.arquivos).toBe(2);
    expect(hist.listar(raiz, arq('Hardware/top.v')).versoes).toHaveLength(1);
  });

  it('o segundo ponto quase nao escreve, porque conteudo igual nao vira versao', () => {
    escrever('a.v', 'mesmo conteudo\n');
    hist.criarPonto(raiz, { agora: 1000 });
    hist.criarPonto(raiz, { agora: 2000 });
    hist.criarPonto(raiz, { agora: 3000 });

    expect(hist.listar(raiz, arq('a.v')).versoes).toHaveLength(1);
    expect(hist.listarPontos(raiz).pontos).toHaveLength(3);
  });

  it('nao varre o que nao e fonte do projeto', () => {
    escrever('node_modules/pacote/index.js', 'x');
    escrever('.git/config', 'x');
    escrever('Temp/lixo.v', 'x');
    escrever('bom.v', 'x');

    const fontes = hist.fontesDoProjeto(raiz).map((f) => path.basename(f));
    expect(fontes).toEqual(['bom.v']);
  });
});

describe('ponto: qual versao e a daquele instante', () => {
  const v = (id, quando) => ({ id, quando });

  it('a mais recente com carimbo menor ou igual', () => {
    const versoes = [v('a', 100), v('b', 200), v('c', 300)];
    expect(hist.versaoNoInstante(versoes, 250).id).toBe('b');
    expect(hist.versaoNoInstante(versoes, 300).id).toBe('c');
    expect(hist.versaoNoInstante(versoes, 999).id).toBe('c');
  });

  it('nada quando todas sao posteriores ao instante', () => {
    expect(hist.versaoNoInstante([v('a', 500)], 100)).toBeNull();
  });
});

describe('ponto: a previa, antes de mexer em qualquer coisa', () => {
  it('lista o que muda e o que foi criado depois', () => {
    escrever('a.v', 'ANTES\n');
    hist.criarPonto(raiz, { agora: 1000 });

    // A IA mexe: reescreve um e cria outro.
    fs.writeFileSync(arq('a.v'), 'DEPOIS\n', 'utf8');
    hist.gravarVersao(raiz, arq('a.v'), 'DEPOIS\n', { agora: 2000 });
    escrever('inventado.v', 'novo em folha\n');

    const previa = hist.previaDoPonto(raiz, hist.listarPontos(raiz).pontos[0].id);

    expect(previa.ok).toBe(true);
    expect(previa.restaurar.map((r) => r.arquivo)).toEqual(['a.v']);
    expect(previa.novos).toEqual(['inventado.v']);
  });

  it('arquivo que nao mudou nao entra na previa', () => {
    escrever('a.v', 'parado\n');
    hist.criarPonto(raiz, { agora: 1000 });

    const previa = hist.previaDoPonto(raiz, hist.listarPontos(raiz).pontos[0].id);
    expect(previa.restaurar).toEqual([]);
    expect(previa.novos).toEqual([]);
  });

  it('ponto inexistente devolve erro em vez de mexer em algo', () => {
    expect(hist.previaDoPonto(raiz, '2020-01-01T00-00-00-000')).toMatchObject({ ok: false });
  });
});

describe('ponto: voltar', () => {
  it('devolve o conteudo anterior e manda o arquivo novo para a lixeira', async () => {
    escrever('a.v', 'ANTES\n');
    hist.criarPonto(raiz, { agora: 1000 });
    fs.writeFileSync(arq('a.v'), 'DEPOIS\n', 'utf8');
    hist.gravarVersao(raiz, arq('a.v'), 'DEPOIS\n', { agora: 2000 });
    escrever('inventado.v', 'novo\n');

    const paraLixeira = [];
    const id = hist.listarPontos(raiz).pontos[0].id;
    const r = await hist.rebobinar(raiz, id, {
      trashItem: async (p) => { paraLixeira.push(path.basename(p)); fs.unlinkSync(p); },
    });

    expect(r.ok).toBe(true);
    expect(r.restaurados).toBe(1);
    expect(r.removidos).toBe(1);
    expect(ler('a.v')).toBe('ANTES\n');
    // Lixeira, e nao unlink direto: o que a IA criou pode ser recuperado.
    expect(paraLixeira).toEqual(['inventado.v']);
  });

  it('voltar tambem tem volta: o estado de agora vira um ponto antes de mexer', async () => {
    escrever('a.v', 'v1\n');
    hist.criarPonto(raiz, { agora: 1000 });
    fs.writeFileSync(arq('a.v'), 'v2\n', 'utf8');
    hist.gravarVersao(raiz, arq('a.v'), 'v2\n', { agora: 2000 });

    const antes = hist.listarPontos(raiz).pontos.length;
    await hist.rebobinar(raiz, hist.listarPontos(raiz).pontos[0].id, { trashItem: async () => {} });

    const depois = hist.listarPontos(raiz).pontos;
    expect(depois.length).toBe(antes + 1);
    expect(depois[0].rotulo).toBe('antes de voltar');
  });

  it('o rotulo do ponto sobrevive na lista, para a pessoa reconhecer o instante', () => {
    escrever('a.v', 'x');
    hist.criarPonto(raiz, { rotulo: 'antes de pedir o refatorar', mensagemId: 'msg-7' });

    const p = hist.listarPontos(raiz).pontos[0];
    expect(p.rotulo).toBe('antes de pedir o refatorar');
    expect(p.mensagemId).toBe('msg-7');
  });
});
