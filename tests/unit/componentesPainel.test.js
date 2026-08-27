// @vitest-environment happy-dom
/**
 * O painel de componentes (js/ui/components_panel.js).
 *
 * O painel é o que dezenas de alunos e pesquisadores olham para decidir se
 * baixam 272 MB. Um rótulo errado aqui não quebra nada e não aparece em log
 * nenhum: aparece como alguém achando que tem uma coisa que não tem, ou
 * re-baixando o que já está no disco. Por isso o que este teste prende é o mapa
 * ESTADO → o que o cartão mostra e o que o botão faz:
 *
 *   ausente        → selo "Não instalado", botão Baixar (sem --force)
 *   ausente + compila → selo "Necessário para compilar", o único urgente
 *   ok             → selo "Instalado", botão Remover
 *   desatualizado  → selo "Atualização disponível", Atualizar (com --force) E
 *                    Remover, porque a pessoa tem o componente instalado
 *   essencial      → selo "Vem no instalador", nenhum botão
 *
 * Sempre UM selo, nunca dois. A regra de qual deles vale mora em `selosDe`, com
 * teste próprio em componentSelos.test.js; aqui o que se prende é que o CARTÃO
 * reflete essa regra e que o botão faz o que promete.
 *
 * E o rodapé, que é onde a soma dos downloads pendentes aparece.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** O IPC do painel, trocado por um espião. */
const electronAPI = {
  componentesListar: vi.fn(),
  componentesInstalar: vi.fn(async () => ({ ok: true })),
  componentesRemover: vi.fn(async () => ({ ok: true, liberadoMB: 43 })),
  componentesDoctor: vi.fn(async () => ({ ok: true, consertados: [] })),
  componentesAbrirPasta: vi.fn(),
  onComponenteProgresso: vi.fn(),
  onComponenteAusente: vi.fn(),
};

vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog: vi.fn(async () => 'remover') }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));

const { desenhar, ligar, limparSelecao } = await import('../../js/ui/components_panel.js');

/** Um componente do catálogo, com o que o painel realmente lê. */
function comp(over = {}) {
  return {
    chave: 'surfer',
    nome: 'Surfer',
    resumo: 'O visualizador de formas de onda embutido.',
    tamanhoMB: 43,
    downloadMB: 16,
    essencial: false,
    estado: 'ausente',
    instalado: false,
    versaoInstalada: null,
    ...over,
  };
}

function montarDom() {
  document.body.innerHTML = '<div id="componentes-lista"></div><span id="componentes-espaco"></span>';
}

async function pintar(lista) {
  montarDom();
  // `ligar` depois do DOM existir: a delegacao de clique mora na caixa da
  // lista, e no aplicativo isso acontece no DOMContentLoaded.
  ligar();
  electronAPI.componentesListar.mockResolvedValue({ componentes: lista, baixando: null });
  await desenhar();
}

const cartao = (chave) => document.querySelector(`.componente[data-chave="${chave}"]`);
const selos = (chave) => [...cartao(chave).querySelectorAll('.componente-selo')].map((s) => s.textContent.trim());
const botoes = (chave) => [...cartao(chave).querySelectorAll('button')].map((b) => ({
  texto: b.textContent.trim(),
  instalar: b.getAttribute('data-instalar'),
  remover: b.getAttribute('data-remover'),
  forcar: b.hasAttribute('data-forcar'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  electronAPI.componentesInstalar.mockResolvedValue({ ok: true });
  electronAPI.componentesRemover.mockResolvedValue({ ok: true, liberadoMB: 43 });
});

describe('o cartão diz a verdade sobre cada estado', () => {
  it('ausente: só Baixar, e o tamanho citado é o do download', async () => {
    await pintar([comp()]);
    expect(selos('surfer')).toEqual(['Não instalado']);
    expect(botoes('surfer')).toEqual([
      { texto: 'Baixar', instalar: 'surfer', remover: null, forcar: false },
    ]);
    expect(cartao('surfer').querySelector('.componente-tamanho').textContent).toContain('16 MB');
  });

  it('instalado e em dia: só Remover, e o tamanho citado é o do disco', async () => {
    await pintar([comp({ estado: 'ok', instalado: true, versaoInstalada: 'v0.7.0-nips.10' })]);
    expect(selos('surfer')).toEqual(['Instalado']);
    expect(botoes('surfer')).toEqual([
      { texto: 'Remover', instalar: null, remover: 'surfer', forcar: false },
    ]);
    expect(cartao('surfer').querySelector('.componente-tamanho').textContent).toContain('43 MB');
  });

  it('desatualizado: Atualizar (com --force) e Remover, e cita o download', async () => {
    await pintar([comp({ estado: 'desatualizado', instalado: true, versaoInstalada: 'v0.7.0-nips.2' })]);
    expect(selos('surfer')).toEqual(['Atualização disponível']);
    expect(botoes('surfer')).toEqual([
      { texto: 'Atualizar', instalar: 'surfer', remover: null, forcar: true },
      { texto: 'Remover', instalar: null, remover: 'surfer', forcar: false },
    ]);
    expect(cartao('surfer').querySelector('.componente-tamanho').textContent).toContain('16 MB');
  });

  it('essencial: nenhum botão, porque não há decisão a tomar', async () => {
    await pintar([comp({ chave: 'yanc', nome: 'YANC', essencial: true, estado: 'ok', instalado: true })]);
    expect(selos('yanc')).toEqual(['Vem no instalador']);
    expect(botoes('yanc')).toEqual([]);
  });

  it('essencial desatualizado: Atualizar, e nunca Remover', async () => {
    // O YANC vem no instalador e não sai; oferecer Remover aqui deixaria a
    // AURORA sem o compilador do SAPHO com um clique.
    await pintar([comp({
      chave: 'yanc', nome: 'YANC', essencial: true, estado: 'desatualizado',
      instalado: true, versaoInstalada: 'v5.2',
    })]);
    expect(botoes('yanc')).toEqual([
      { texto: 'Atualizar', instalar: 'yanc', remover: null, forcar: true },
    ]);
  });

  it('o que compila e não está aqui é urgente, não recurso a menos', async () => {
    await pintar([comp({ chave: 'msys', nome: 'MSYS', requerParaCompilar: true, downloadMB: 272 })]);
    // Era "Não instalado" + "Necessário para compilar", dois selos dizendo
    // pedaços da mesma coisa. Sobrou o que carrega a urgência, e ele ficou
    // MAIS visível por isso: agora é o único selo da lista inteira, porque
    // nenhum outro estado tem um.
    expect(selos('msys')).toEqual(['Necessário para compilar']);
    expect(cartao('msys').classList.contains('componente-urgente')).toBe(true);
  });
});

describe('o clique chega ao main com o que o botão prometeu', () => {
  it('Baixar instala sem forçar', async () => {
    await pintar([comp()]);
    cartao('surfer').querySelector('[data-instalar]').click();
    await vi.waitFor(() => expect(electronAPI.componentesInstalar).toHaveBeenCalled());
    expect(electronAPI.componentesInstalar).toHaveBeenCalledWith('surfer', { forcar: false });
  });

  it('Atualizar instala COM --force: sem isso o instalador veria a sentinela e sairia', async () => {
    await pintar([comp({ estado: 'desatualizado', instalado: true, versaoInstalada: 'v1' })]);
    cartao('surfer').querySelector('[data-instalar]').click();
    await vi.waitFor(() => expect(electronAPI.componentesInstalar).toHaveBeenCalled());
    expect(electronAPI.componentesInstalar).toHaveBeenCalledWith('surfer', { forcar: true });
  });

  it('Remover pede confirmação antes, e só então remove', async () => {
    const { showDialog } = await import('../../js/ui/dialog_manager.js');
    await pintar([comp({ estado: 'ok', instalado: true })]);
    cartao('surfer').querySelector('[data-remover]').click();
    await vi.waitFor(() => expect(electronAPI.componentesRemover).toHaveBeenCalled());
    expect(showDialog).toHaveBeenCalled();
    expect(electronAPI.componentesRemover).toHaveBeenCalledWith('surfer');
  });

  it('Cancelar na confirmação não remove nada', async () => {
    const { showDialog } = await import('../../js/ui/dialog_manager.js');
    showDialog.mockResolvedValueOnce('cancel');
    await pintar([comp({ estado: 'ok', instalado: true })]);
    cartao('surfer').querySelector('[data-remover]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(electronAPI.componentesRemover).not.toHaveBeenCalled();
  });
});

describe('o rodapé soma o que falta baixar', () => {
  it('conta os ausentes e os desatualizados separadamente', async () => {
    await pintar([
      comp({ chave: 'surfer', downloadMB: 16 }),
      comp({ chave: 'gtkwave', downloadMB: 30 }),
      comp({ chave: 'verible', estado: 'desatualizado', instalado: true, downloadMB: 2 }),
    ]);
    const texto = document.getElementById('componentes-espaco').textContent;
    expect(texto).toContain('2 disponíveis para baixar, 46 MB');
    expect(texto).toContain('1 com atualização disponível (2 MB de download)');
  });

  it('tudo instalado e em dia: uma frase só, e nenhuma soma', async () => {
    await pintar([comp({ estado: 'ok', instalado: true })]);
    expect(document.getElementById('componentes-espaco').textContent).toBe('Tudo instalado.');
  });

  it('componente essencial não entra na conta do que falta baixar', async () => {
    await pintar([comp({ chave: 'yanc', essencial: true, estado: 'ok', instalado: true })]);
    expect(document.getElementById('componentes-espaco').textContent).toBe('Tudo instalado.');
  });
});

/**
 * O ponto de aviso na engrenagem da toolbar.
 *
 * O aviso de boot é um diálogo, e diálogo se fecha. Quem clica "Agora não" fica
 * com uma máquina que não compila e, sem este ponto, nenhum sinal na tela até o
 * próximo boot.
 */
describe('o ponto de aviso na engrenagem', () => {
  const ponto = () => document.getElementById('settings-badge');

  async function pintarComBadge(lista) {
    document.body.innerHTML = '<div id="componentes-lista"></div>'
      + '<span id="componentes-espaco"></span>'
      + '<button id="aurora-settings"><span id="settings-badge" hidden></span></button>';
    ligar();
    electronAPI.componentesListar.mockResolvedValue({ componentes: lista, baixando: null });
    await desenhar();
  }

  it('acende quando falta o que a máquina precisa para compilar', async () => {
    await pintarComBadge([comp({ chave: 'msys', requerParaCompilar: true })]);
    expect(ponto().hidden).toBe(false);
  });

  it('fica apagado quando o que falta é opcional, porque isso é escolha', async () => {
    await pintarComBadge([comp({ requerParaCompilar: false })]);
    expect(ponto().hidden).toBe(true);
  });

  it('apaga assim que o que faltava aparece', async () => {
    await pintarComBadge([comp({ chave: 'msys', requerParaCompilar: true })]);
    expect(ponto().hidden).toBe(false);
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp({ chave: 'msys', requerParaCompilar: true, instalado: true, estado: 'ok' })],
      baixando: null,
    });
    await desenhar();
    expect(ponto().hidden).toBe(true);
  });

  it('não quebra numa tela sem o ponto (a splash, ou um teste sem toolbar)', async () => {
    await pintar([comp({ chave: 'msys', requerParaCompilar: true })]);
    expect(ponto()).toBeNull();
  });
});

/**
 * A fila de download.
 *
 * O que este bloco prende, e que é o ponto do recurso: quem marca quatro
 * componentes e vai tomar café espera encontrar instalado o que deu, não a
 * fila parada no segundo.
 */
describe('a fila de download', () => {
  async function pintarComFila(lista) {
    document.body.innerHTML = '<div id="componentes-lista"></div>'
      + '<span id="componentes-espaco"></span>'
      + '<div id="componentes-fila" hidden><span id="componentes-fila-resumo"></span>'
      + '<button id="componentes-fila-limpar"></button>'
      + '<button id="componentes-fila-baixar"></button></div>';
    ligar();
    electronAPI.componentesListar.mockResolvedValue({ componentes: lista, baixando: null });
    await desenhar();
  }
  const marcar = (chave) => {
    const c = document.querySelector(`[data-marcar="${chave}"]`);
    c.checked = true;
    c.dispatchEvent(new Event('click', { bubbles: true }));
  };
  const barra = () => document.getElementById('componentes-fila');

  it('a caixa de seleção só existe onde há o que baixar', async () => {
    await pintarComFila([
      comp({ chave: 'surfer' }),                                            // ausente
      comp({ chave: 'msys', instalado: true, estado: 'ok' }),               // em dia
      comp({ chave: 'yanc', essencial: true, instalado: true, estado: 'ok' }),
      comp({ chave: 'gtkwave', instalado: true, estado: 'desatualizado' }),
    ]);
    const temCaixa = (k) => !!document.querySelector(`[data-marcar="${k}"]`);
    expect(temCaixa('surfer')).toBe(true);
    expect(temCaixa('gtkwave')).toBe(true);
    expect(temCaixa('msys')).toBe(false);
    expect(temCaixa('yanc')).toBe(false);
  });

  it('a barra aparece só com algo marcado, e soma o download', async () => {
    await pintarComFila([comp({ chave: 'surfer', downloadMB: 16 }), comp({ chave: 'x', downloadMB: 24 })]);
    expect(barra().hidden).toBe(true);
    marcar('surfer');
    marcar('x');
    expect(barra().hidden).toBe(false);
    expect(document.getElementById('componentes-fila-resumo').textContent).toContain('40 MB');
  });

  it('instala um de cada vez, na ordem, e força só quem está desatualizado', async () => {
    await pintarComFila([
      comp({ chave: 'surfer' }),
      comp({ chave: 'gtkwave', instalado: true, estado: 'desatualizado' }),
    ]);
    marcar('surfer');
    marcar('gtkwave');
    document.getElementById('componentes-fila-baixar').click();
    await vi.waitFor(() => expect(electronAPI.componentesInstalar).toHaveBeenCalledTimes(2));
    expect(electronAPI.componentesInstalar.mock.calls).toEqual([
      ['surfer', { forcar: false }],
      ['gtkwave', { forcar: true }],
    ]);
  });

  it('NÃO para no primeiro erro, e diz no fim quem ficou de fora', async () => {
    const { showCardNotification } = await import('../../js/ui/notification.js');
    await pintarComFila([
      comp({ chave: 'a', nome: 'A' }),
      comp({ chave: 'b', nome: 'B' }),
      comp({ chave: 'c', nome: 'C' }),
    ]);
    electronAPI.componentesInstalar.mockImplementation(async (chave) => (
      chave === 'b' ? { ok: false, erro: 'rede' } : { ok: true }
    ));
    marcar('a'); marcar('b'); marcar('c');
    document.getElementById('componentes-fila-baixar').click();
    await vi.waitFor(() => expect(electronAPI.componentesInstalar).toHaveBeenCalledTimes(3));
    const texto = showCardNotification.mock.calls.at(-1)[0];
    expect(texto).toContain('2');   // dois entraram
    expect(texto).toContain('B');   // e o que ficou de fora vai pelo nome
  });
});

/**
 * Todos os selos moram na mesma célula, ao lado do nome: eles dizem ESTADO, e
 * estado pertence ao nome, não à coluna dos botões.
 */
describe('o lugar do selo', () => {
  const naLinhaDoNome = (k) => [...cartao(k).querySelectorAll('.componente-selos .componente-selo')]
    .map((s) => s.textContent.trim());
  const naAcao = (k) => cartao(k).querySelectorAll('.componente-acao .componente-selo').length;

  it('o do essencial fica junto do nome, como os outros', async () => {
    await pintar([comp({ chave: 'yanc', essencial: true, instalado: true, estado: 'ok' })]);
    expect(naLinhaDoNome('yanc')).toEqual(['Vem no instalador']);
    expect(naAcao('yanc')).toBe(0);
  });

  it('o de urgência também', async () => {
    await pintar([comp({ chave: 'msys', requerParaCompilar: true })]);
    expect(naLinhaDoNome('msys')).toEqual(['Necessário para compilar']);
    expect(naAcao('msys')).toBe(0);
  });

  it('essencial desatualizado mostra a novidade, e não a origem', async () => {
    // O selo do essencial diria "Vem no instalador", que é verdade e é a
    // informação menos útil possível num cartão que acabou de ganhar uma
    // versão nova. Quem manda é o estado, e o botão confirma.
    await pintar([comp({
      chave: 'yanc', essencial: true, instalado: true, estado: 'desatualizado',
    })]);
    expect(naLinhaDoNome('yanc')).toEqual(['Atualização disponível']);
    expect(botoes('yanc').map((b) => b.texto)).toEqual(['Atualizar']);
  });
});

describe('a seleção sobrevive ao redesenho', () => {
  // A seleção é de módulo e sobrevive a fechar e reabrir o painel, que é o
  // comportamento certo e torna um teste dependente do anterior se ele não
  // zerar. Descoberto aqui: o segundo caso via a marcação do primeiro.
  beforeEach(() => limparSelecao());

  const marcar = (chave) => {
    const caixa = cartao(chave).querySelector('.componente-marcar');
    caixa.click();
    return caixa;
  };
  const marcada = (chave) => {
    const caixa = cartao(chave)?.querySelector('.componente-marcar');
    return caixa ? caixa.checked : null;
  };

  it('remover um componente não apaga a marcação dos outros', async () => {
    // O caso real: a pessoa marca dois para baixar, lembra de remover um
    // terceiro antes, e a lista se refaz inteira por causa da remoção. Antes
    // disto a fila zerava sem ninguém avisar, e ela remarcaria os dois sem
    // entender o que aconteceu.
    const lista = [
      comp({ chave: 'claude' }),
      comp({ chave: 'codex' }),
      comp({ chave: 'surfer', instalado: true, estado: 'ok' }),
    ];
    await pintar(lista);
    marcar('claude');
    marcar('codex');
    expect([marcada('claude'), marcada('codex')]).toEqual([true, true]);

    // A remoção do surfer devolve a lista com ele já ausente.
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp({ chave: 'claude' }), comp({ chave: 'codex' }), comp({ chave: 'surfer' })],
      baixando: null,
    });
    cartao('surfer').querySelector('[data-remover]').click();
    await vi.waitFor(() => expect(electronAPI.componentesRemover).toHaveBeenCalledWith('surfer'));
    await vi.waitFor(() => expect(cartao('surfer').querySelector('[data-instalar]')).toBeTruthy());

    expect([marcada('claude'), marcada('codex')]).toEqual([true, true]);
    // E o que foi removido NÃO entra na seleção sozinho: ele virou baixável
    // agora, mas ninguém o marcou.
    expect(marcada('surfer')).toBe(false);
  });

  it('o que acabou de instalar sai da seleção sozinho', async () => {
    await pintar([comp({ chave: 'codex' })]);
    marcar('codex');
    expect(marcada('codex')).toBe(true);

    // Instalado: some a caixa, porque não há mais o que baixar.
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp({ chave: 'codex', instalado: true, estado: 'ok' })],
      baixando: null,
    });
    await desenhar();
    expect(marcada('codex')).toBe(null);

    // E a prova de que a marcação saiu do conjunto, e não só da tela: se ele
    // voltar a ser baixável, volta DESMARCADO.
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp({ chave: 'codex' })],
      baixando: null,
    });
    await desenhar();
    expect(marcada('codex')).toBe(false);
  });
});
