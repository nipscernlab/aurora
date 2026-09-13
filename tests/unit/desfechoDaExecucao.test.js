/**
 * O desfecho gravado no historico de compilacao: js/compilation/run_log.js.
 *
 * O bug que isto fixa foi visto na tela: o historico dizia OK para compilacoes
 * que a pessoa tinha acabado de ver falhar. No disco, `cmmcomp.exe code=1`
 * gravado com `ok: true`. A causa e um encadeamento de tres fatos, cada um
 * razoavel sozinho: o executor nunca rejeita (devolve `{ code }` mesmo com
 * saida nao zero); cada handler captura o erro do compilador, mostra "Erro
 * Fatal" no terminal e retorna normalmente; e o registro marcava OK sempre que a
 * promessa do corpo resolvia. Resolver nao quer dizer dar certo.
 *
 * O codigo de saida dos passos NAO entra na decisao, e isso e escolha, nao
 * esquecimento: o passo de hierarquia do yosys falha com code=1 e e tratado
 * como aviso de proposito (a arvore ja esta montada). Uma regra "qualquer passo
 * nao zero falhou" marcaria como falha rodadas do PRISM que funcionaram. O que
 * vale e o que o handler decidiu, e ele decide chamando o funil de erro fatal.
 *
 * Cancelar e um terceiro estado, nao uma falha nem um OK.
 */

import { describe, it, expect } from 'vitest';
import { desfechoDaExecucao, abrirExecucao, fecharExecucao, problemasParaRegistro } from '../../js/compilation/run_log.js';

describe('desfecho: resolver nao e dar certo', () => {
  it('sem falha reportada e sem cancelamento, e OK', () => {
    expect(desfechoDaExecucao({ resolveu: true })).toEqual({ ok: true, erro: null, cancelada: false });
  });

  it('o handler reportou falha fatal e retornou normalmente: FALHOU, com a mensagem', () => {
    // E exatamente o caso do disco: cmmcomp.exe code=1, excecao engolida no
    // catch do handler, promessa resolvida.
    const d = desfechoDaExecucao({
      resolveu: true,
      falha: { mensagem: 'C+- compilation failed with exit code 1' },
    });
    expect(d.ok).toBe(false);
    expect(d.cancelada).toBe(false);
    expect(d.erro).toBe('C+- compilation failed with exit code 1');
  });

  it('a promessa rejeitou: falhou, com a mensagem do erro', () => {
    const d = desfechoDaExecucao({ resolveu: false, erro: new Error('estourou') });
    expect(d).toEqual({ ok: false, erro: 'estourou', cancelada: false });
  });

  it('rejeitou com algo que nao e Error: ainda assim guarda o texto', () => {
    expect(desfechoDaExecucao({ resolveu: false, erro: 'texto cru' }).erro).toBe('texto cru');
    expect(desfechoDaExecucao({ resolveu: false }).erro).toBeNull();
  });
});

describe('desfecho: cancelar e um terceiro estado', () => {
  it('cancelada vence tudo, e nao vira nem OK nem falha', () => {
    expect(desfechoDaExecucao({ resolveu: true, cancelada: true }))
      .toEqual({ ok: false, erro: null, cancelada: true });
    expect(desfechoDaExecucao({ resolveu: false, erro: new Error('kill'), cancelada: true }))
      .toEqual({ ok: false, erro: null, cancelada: true });
  });

  it('falha reportada E cancelamento: fica cancelada, sem mensagem de erro', () => {
    // O passo morto pelo cancel rejeita com "exit code 1"; isso e o kill, nao
    // um defeito, e o historico nao pode culpar o codigo da pessoa por ele.
    const d = desfechoDaExecucao({
      resolveu: true,
      falha: { mensagem: 'cocotb simulation failed with exit code 1' },
      cancelada: true,
    });
    expect(d).toEqual({ ok: false, erro: null, cancelada: true });
  });
});

describe('desfecho: o que vai para o disco', () => {
  it('fecharExecucao grava o desfecho como veio, e o erro cabe em 2000 chars', () => {
    const exec = abrirExecucao({ pedido: 'cmm', agora: 1000 });
    fecharExecucao(exec, {
      ...desfechoDaExecucao({ resolveu: true, falha: { mensagem: 'x'.repeat(5000) } }),
      agora: 1500,
    });
    expect(exec.ok).toBe(false);
    expect(exec.cancelada).toBe(false);
    expect(exec.erro).toHaveLength(2000);
    expect(exec.ms).toBe(500);
  });

  it('o registro em si nao carrega a marca de falha: ela e recado interno do fluxo', () => {
    // A marca vive num WeakMap no compilation_flow, nao num campo do registro.
    // Se um dia ela vazar para o JSON, este teste avisa.
    const exec = abrirExecucao({ pedido: 'cmm', agora: 1000 });
    fecharExecucao(exec, desfechoDaExecucao({ resolveu: true, falha: { mensagem: 'e' } }));
    expect(Object.keys(exec)).not.toContain('falha');
    expect(Object.keys(exec)).not.toContain('falhaReportada');
  });
});

/**
 * O historico passa a dizer o ERRO, e nao so o codigo de saida.
 *
 * O Chrysthofer abriu o detalhe de uma compilacao que falhou e leu "CMM
 * compilation failed with code 1". Isso e a frase que a AURORA monta a partir
 * do codigo de saida: diz QUE falhou e nao diz O QUE houve. A mensagem do
 * compilador ("Erro na linha 2: se voce declarar a variavel y eu agradeco")
 * existia so no terminal e sumia junto com ele.
 *
 * O conserto nao pede nada ao YANC: a leitura da saida ja e feita para pintar
 * os marcadores no editor, e o registro passa a carregar o resultado dela.
 *
 * O corte em vinte e deliberado. O registro vai para o disco e e lido inteiro
 * pela tela, e um build que falha em cascata imprime centenas de linhas; os
 * primeiros sao os que importam, porque em compilador o primeiro erro costuma
 * ser a causa dos outros.
 */
describe('registro: os problemas que o compilador relatou', () => {
  const grupo = (arquivo, ...problemas) => ({ arquivo, problemas });
  const p = (linha, mensagem, extra = {}) => ({
    linha, mensagem, severidade: 'erro', ferramenta: 'yanc', coluna: null, ...extra,
  });

  it('achata os grupos por arquivo numa lista so, com o lugar de cada um', () => {
    const r = problemasParaRegistro([
      grupo('Software/proc.cmm', p(2, 'declare a variavel y')),
      grupo('Hardware/top.v', p(5, 'Invalid module item.', { ferramenta: 'icarus' })),
    ]);

    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ arquivo: 'Software/proc.cmm', linha: 2, mensagem: 'declare a variavel y' });
    expect(r[1]).toMatchObject({ arquivo: 'Hardware/top.v', ferramenta: 'icarus' });
  });

  it('corta em vinte, porque o registro vai para o disco e a tela le tudo', () => {
    const muitos = Array.from({ length: 50 }, (_, i) => p(i + 1, `erro ${i}`));
    const r = problemasParaRegistro([grupo('a.v', ...muitos)]);

    expect(r).toHaveLength(20);
    // Os PRIMEIROS: em compilador, o primeiro erro costuma causar os outros.
    expect(r[0].mensagem).toBe('erro 0');
  });

  it('corta mensagem muito longa em vez de guardar um log inteiro', () => {
    const r = problemasParaRegistro([grupo('a.v', p(1, 'x'.repeat(2000)))]);
    expect(r[0].mensagem).toHaveLength(500);
  });

  it('sem problema nenhum, nao inventa lista', () => {
    expect(problemasParaRegistro([])).toEqual([]);
    expect(problemasParaRegistro(null)).toEqual([]);
    expect(problemasParaRegistro([grupo('a.v')])).toEqual([]);
  });

  it('o campo so entra no registro quando ha o que contar', () => {
    const semNada = abrirExecucao({ pedido: 'cmm', agora: 1000 });
    fecharExecucao(semNada, { ok: true, problemas: [] });
    expect('problemas' in semNada).toBe(false);

    const comErro = abrirExecucao({ pedido: 'cmm', agora: 1000 });
    fecharExecucao(comErro, { ok: false, problemas: problemasParaRegistro([grupo('a.cmm', p(2, 'algo'))]) });
    expect(comErro.problemas).toHaveLength(1);
    expect(comErro.problemas[0].mensagem).toBe('algo');
  });
});
