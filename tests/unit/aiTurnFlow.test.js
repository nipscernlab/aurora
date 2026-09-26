// @vitest-environment happy-dom
//
// A rede em volta do turno do painel de IA (js/ui/ai_assistant_manager.js).
//
// Por que este arquivo existe: o TODO decidiu que os god files se abrem
// cobrindo por fora antes de mover codigo por dentro, e o ai_assistant_manager
// tem 3513 linhas numa classe so. O compilation_module ja ganhou a sua rede
// (compilationWaveFlow.test.js); esta e a do outro.
//
// ONDE amarrar foi medido, nao deduzido. Seguindo as chamadas `this.x(` a
// partir de cada entrada publica, o grafo estatico e enganoso: `initialize` e
// `attachListeners` "alcancam" 103 dos 116 metodos porque registram quase todos
// como handler de evento, o que nao e alcance de teste nenhum. O que um teste
// consegue DIRIGIR de verdade e o turno: `send` alcanca 53 metodos e 1291
// linhas, e o cacho do `_dispatchTurn` (despacho, pacotes do stream, fila,
// parada, cao de guarda, turno autonomo) responde por 1109 delas. E o unico
// ponto que rende esse tanto de rede por linha de teste.
//
// O que torna isso possivel sem subir a janela: o painel CONSTROI o proprio
// DOM (`initialize` cria o container e escreve o innerHTML inteiro), entao o
// happy-dom basta, e o mundo entra por uma superficie pequena e declarada,
// `window.aiAPI` com catorze metodos. Trocar o mundo e trocar um objeto.
//
// O que fica travado aqui e o CONTRATO que uma refatoracao quebra: o que vai
// no `startChat`, o filtro por sessao, a ordem prosa-ferramenta-prosa como ela
// e GRAVADA (que e o que faz uma conversa reaberta reproduzir o layout ao
// vivo), a higiene de memoria dos anexos, as duas filas de follow-up, a parada,
// o cao de guarda e o limite da corrente autonoma. Detalhe interno de metodo
// nao entra, que e justamente o que vai mudar de lugar.
//
// TRES ARMADILHAS, as tres encontradas escrevendo este arquivo, e as tres
// produzem teste verde que nao testa nada:
//
//   1. O modulo exporta um SINGLETON, nao a classe. Reusar a instancia entre
//      casos carrega `messages`, `currentChatId` e o container do caso
//      anterior. Aqui cada caso constroi uma instancia nova pelo
//      `.constructor`, e o corpo do documento e refeito.
//   2. O painel so despacha depois de `refreshProviders`, porque `send`
//      desiste calado sem `currentProvider`. Um caso que esquecesse disso
//      passaria verde sem ter chamado `startChat` uma vez, entao cada caso
//      confere o que exercitou, e nao so se houve excecao.
//   3. `handleChatEvent` descarta todo pacote cujo `sessionId` nao bate. Um
//      falso que inventasse o id emitiria no vazio e o teste veria uma tela
//      vazia sem entender por que. O id sai SEMPRE do payload que o
//      `startChat` recebeu, como o backend de verdade faz.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// As bordas que nao interessam ao turno.
vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({
  TabManager: { addTab: vi.fn(), tabs: new Map() },
}));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { STREAM_STALL_MS } from '../../js/ai/ai_metadata.js';
import { ProjectStore } from '../../js/project/project_store.js';
import { electronAPI } from '../../js/app/electron_api.js';
import { TabManager } from '../../js/tabs/tab_manager.js';
import { showCardNotification } from '../../js/ui/notification.js';

const AIAssistantManager = aiAssistantManager.constructor;

/**
 * O `window.aiAPI` de mentira, com a FORMA do canal real (main/ipc/ai.js):
 * `startChat` devolve `{ ok }` e o trabalho chega depois, por pacote, no
 * callback registrado em `onChatEvent`. Um falso que respondesse o turno
 * inteiro de dentro do `startChat` inverteria essa ordem e o painel nunca
 * exercitaria o caminho que ele usa em producao.
 */
function makeAiAPI(over = {}) {
  const api = {
    chamadas: { startChat: [], abort: [], salvos: [], push: [] },
    emitir: null,                       // preenchido por onChatEvent
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'claude-x', defaultModel: 'claude-x' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    newConversationId: vi.fn(async () => ({ id: 'c-teste' })),
    onChatEvent: vi.fn((cb) => { api.emitir = cb; return () => { api.emitir = null; }; }),
    startChat: vi.fn(async (payload) => { api.chamadas.startChat.push(payload); return { ok: true }; }),
    abortChat: vi.fn(async (sid) => { api.chamadas.abort.push(sid); return { ok: true }; }),
    pushChatMessage: undefined,         // so o motor do SDK tem canal vivo
    saveConversation: vi.fn(async (c) => { api.chamadas.salvos.push(c); return { ok: true }; }),
    listConversations: vi.fn(async () => ({ conversations: [] })),
    readConversation: vi.fn(async () => ({ ok: false })),
    renameConversation: vi.fn(async () => ({ ok: true })),
    deleteConversation: vi.fn(async () => ({ ok: true })),
    setModel: vi.fn(async () => ({ ok: true })),
  };
  return Object.assign(api, over);
}

let api;
let painel;

/** Sobe o painel como o renderer sobe: monta, descobre provedor, abre. */
async function abrirPainel() {
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  return painel;
}

/** Manda uma mensagem pelo composer, como a pessoa manda. */
async function mandar(texto) {
  painel.inputEl.value = texto;
  await painel.send();
}

/** O id da sessao do enesimo despacho, que e por onde os pacotes entram. */
function sessao(n = 0) {
  const p = api.chamadas.startChat[n];
  expect(p, `nao houve despacho #${n}`).toBeTruthy();
  return p.sessionId;
}

/** Emite um pacote do backend na sessao corrente. */
function emitir(ev, n = 0) {
  expect(api.emitir, 'ninguem assinou onChatEvent').toBeTypeOf('function');
  api.emitir({ sessionId: sessao(n), ...ev });
}

/** O texto visivel das bolhas, na ordem da tela. */
function bolhas() {
  return Array.from(painel.messagesEl.querySelectorAll('.ai-message')).map((el) => ({
    quem: el.classList.contains('ai-msg-user') ? 'user' : 'assistant',
    erro: el.classList.contains('error'),
    texto: el.querySelector('.ai-msg-content').textContent.trim(),
  }));
}

beforeEach(() => {
  api = makeAiAPI();
  window.aiAPI = api;
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  // O projeto aberto entra pelo store, que e de onde o renderer le; o espelho
  // em window e o do store, como no app.
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  window.ProjectStore = ProjectStore;
  localStorage.clear();
});

afterEach(() => {
  ProjectStore.clearProject();
  vi.useRealTimers();
  painel?._disarmStreamWatchdog?.();
  document.body.innerHTML = '';
});

describe('o turno, de ponta a ponta', () => {
  it('despacha com o que o backend precisa e fecha o turno na tela e no disco', async () => {
    await abrirPainel();
    await mandar('compila o projeto');

    // O que foi despachado. O caminho do projeto e relido a cada turno de
    // proposito (senao o modelo gasta uma tool call para saber onde esta), e e
    // por isso que ele e conferido aqui e nao no chat_turn.
    expect(api.startChat).toHaveBeenCalledTimes(1);
    const p = api.chamadas.startChat[0];
    expect(p.provider).toBe('anthropic');
    expect(p.sessionId).toBeTruthy();
    expect(p.conversationId).toBe('c-teste');
    expect(p.messages).toEqual([{ role: 'user', content: 'compila o projeto' }]);
    expect(p.permission).toBe(painel.permissionMode);

    // Os dois campos vao SEPARADOS, e e o que faz o cache de prompt valer: o
    // que muda por turno nao pode estar dentro do bloco estavel, senao trocar
    // de projeto joga fora o prefixo inteiro. Conferido aqui porque e um
    // contrato entre o painel e o main, e nao um detalhe de montagem.
    expect(p.systemContext).toContain('project_root: C:/proj');
    expect(p.systemContext).toContain('spf_file:     C:/proj/proj.spf');
    expect(p.system).not.toContain('project_root:');

    // Turno livre: o esforco continua sendo o da interface. So operacao tipada
    // (comentar, acharErros, posCompilacao*) troca isso.
    expect(p.operacao).toBeUndefined();

    // Enquanto corre: Stop no lugar de Send.
    expect(painel.stopBtn.classList.contains('hidden')).toBe(false);
    expect(painel.sendBtn.classList.contains('hidden')).toBe(true);

    emitir({ type: 'text-delta', delta: 'Compilando ' });
    emitir({ type: 'text-delta', delta: 'agora.' });
    emitir({ type: 'finish', usage: { totalTokens: 42 } });

    expect(bolhas()).toEqual([
      { quem: 'user', erro: false, texto: 'compila o projeto' },
      { quem: 'assistant', erro: false, texto: 'Compilando agora.' },
    ]);
    expect(painel.messages).toEqual([
      { role: 'user', content: 'compila o projeto' },
      { role: 'assistant', content: 'Compilando agora.' },
    ]);

    // Fim do turno: composer livre e conversa gravada.
    expect(painel._isStreaming).toBe(false);
    expect(painel.stopBtn.classList.contains('hidden')).toBe(true);
    expect(api.chamadas.salvos.at(-1)).toMatchObject({
      id: 'c-teste',
      title: 'compila o projeto',
      provider: 'anthropic',
    });
    expect(api.chamadas.salvos.at(-1).messages).toHaveLength(2);
  });

  it('ignora pacote de outra sessao, que e o que impede um turno morto de escrever na tela', async () => {
    await abrirPainel();
    await mandar('oi');

    api.emitir({ sessionId: 'sessao-de-outro-turno', type: 'text-delta', delta: 'lixo' });
    api.emitir({ sessionId: 'sessao-de-outro-turno', type: 'finish' });

    expect(bolhas()).toEqual([{ quem: 'user', erro: false, texto: 'oi' }]);
    expect(painel._isStreaming).toBe(true);   // o turno de verdade segue vivo
  });

  it('grava prosa, ferramenta e prosa na ordem em que aconteceram', async () => {
    // Este e o contrato que faz uma conversa REABERTA reproduzir o layout ao
    // vivo: o texto anterior a uma ferramenta e gravado como mensagem propria
    // no momento da chamada, e nao empilhado depois do grupo de ferramentas.
    await abrirPainel();
    await mandar('quantos arquivos?');

    emitir({ type: 'text-delta', delta: 'Vou olhar.' });
    emitir({ type: 'tool-call', toolName: 'get_project_tree', args: { depth: 2 }, toolUseId: 't1' });
    emitir({ type: 'tool-result', toolName: 'get_project_tree', result: { ok: true, data: { n: 9 } }, toolUseId: 't1' });
    emitir({ type: 'text-delta', delta: 'Sao nove.' });
    emitir({ type: 'finish' });

    expect(painel.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(painel.messages[1].content).toBe('Vou olhar.');
    expect(painel.messages[2]).toMatchObject({
      toolName: 'get_project_tree', status: 'done', toolUseId: 't1', args: { depth: 2 },
    });
    expect(painel.messages[3].content).toBe('Sao nove.');

    // E na tela o chip fica dentro do grupo, marcado como concluido.
    const chip = painel.messagesEl.querySelector('.ai-tool-chip');
    expect(chip.classList.contains('done')).toBe(true);
    expect(chip.querySelector('.ai-tool-status').textContent).toBe('done');
  });

  it('copia o anexo para o turno e o apaga do historico, para nao reenviar a cada turno', async () => {
    // Higiene de memoria: uma imagem de 8 MB reenviada a cada turno de uma
    // conversa longa e o unico jeito de o painel comer memoria sem limite.
    await abrirPainel();
    painel.pendingAttachments = [
      { id: 'a1', kind: 'image', name: 'onda.png', mime: 'image/png', size: 12, dataUrl: 'data:image/png;base64,AAA' },
    ];
    await mandar('o que e isto?');

    const enviado = api.chamadas.startChat[0].messages[0];
    expect(enviado.attachments[0].dataUrl).toBe('data:image/png;base64,AAA');
    // O payload saiu do historico, mas o que a bolha desenha ficou.
    expect(painel.messages[0].attachments[0].dataUrl).toBeUndefined();
    expect(painel.messages[0].attachments[0].name).toBe('onda.png');

    emitir({ type: 'finish' });
    await mandar('e agora?');
    const segundoTurno = api.chamadas.startChat[1].messages[0];
    expect(segundoTurno.attachments[0].dataUrl).toBeUndefined();
  });
});

describe('as duas filas de follow-up', () => {
  it('enfileira o que a pessoa manda no meio do turno e despacha ao fim dele', async () => {
    await abrirPainel();
    await mandar('primeira');
    await mandar('segunda');          // sem canal vivo: vai para a fila

    expect(api.startChat).toHaveBeenCalledTimes(1);
    expect(painel.queueEl.hidden).toBe(false);
    expect(painel.queueEl.querySelectorAll('.ai-queued-chip')).toHaveLength(1);

    emitir({ type: 'finish' });
    await vi.waitFor(() => expect(api.startChat).toHaveBeenCalledTimes(2));

    // O segundo despacho leva a conversa inteira, nao so a mensagem nova. As
    // duas chegam FUNDIDAS numa mensagem so porque a API exige papeis
    // alternados e o buildApiMessages junta vizinhas de mesmo papel; o
    // historico da tela continua com as duas separadas.
    expect(api.chamadas.startChat[1].messages)
      .toEqual([{ role: 'user', content: 'primeira\n\nsegunda' }]);
    expect(painel.messages.map((m) => m.content)).toEqual(['primeira', 'segunda']);
    expect(painel.queueEl.hidden).toBe(true);
  });

  it('entrega ao turno vivo quando o motor tem canal, sem despachar de novo', async () => {
    api.pushChatMessage = vi.fn(async (sid, texto) => {
      api.chamadas.push.push({ sid, texto });
      return { ok: true, data: { accepted: true } };
    });
    await abrirPainel();
    await mandar('primeira');
    await mandar('segunda');

    expect(api.chamadas.push).toEqual([{ sid: sessao(0), texto: 'segunda' }]);
    expect(api.startChat).toHaveBeenCalledTimes(1);
    // A mensagem foi ENTREGUE a sessao, mas quem decide quando aceita-la e a
    // assistente: ate la ela e uma ficha em espera, e nao um balao. Poe-la na
    // conversa aqui era o defeito relatado em 30/08/2026: o balao ia para o
    // fim enquanto o texto continuava entrando na bolha de cima, e a resposta
    // parecia cortada no meio.
    expect(painel.queueEl.querySelectorAll('.ai-queued-live')).toHaveLength(1);
    expect(painel.messages.map((m) => m.content)).toEqual(['primeira']);

    // O main avisa no momento em que ela pega a mensagem; so entao ela entra.
    emitir({ type: 'follow-up-taken', content: 'segunda' });
    expect(painel.queueEl.querySelectorAll('.ai-queued-live')).toHaveLength(0);
    expect(painel.messages.map((m) => m.content)).toEqual(['primeira', 'segunda']);
  });

  it('o turno que morre devolve a mensagem entregue para a fila, em vez de perde-la', async () => {
    api.pushChatMessage = vi.fn(async () => ({ ok: true, data: { accepted: true } }));
    await abrirPainel();
    await mandar('primeira');
    await mandar('segunda');
    expect(painel.queueEl.querySelectorAll('.ai-queued-live')).toHaveLength(1);

    // A sessao caiu antes de ela aceitar a mensagem. O texto da pessoa nao
    // pode sumir com a sessao: volta para a fila deste lado, e o proximo
    // turno o leva.
    emitir({ type: 'error', message: 'a sessao caiu' });
    expect(painel.queueEl.querySelectorAll('.ai-queued-live')).toHaveLength(0);
    expect(painel._messageQueue.map((m) => m.text)).toEqual(['segunda']);
  });

  it('o finish com `more` sela o segmento sem encerrar o turno, e a resposta seguinte chega', async () => {
    // A regressao que este caso prende: o ramo do `more` chamava commitTurn,
    // que passa por resetTurnState e zera a sessao. Os pacotes da resposta
    // seguinte eram todos descartados pelo filtro de sessao e o painel ficava
    // nos pontinhos ate o cao de guarda matar o turno.
    api.pushChatMessage = vi.fn(async () => ({ ok: true, data: { accepted: true } }));
    await abrirPainel();
    await mandar('primeira');
    emitir({ type: 'text-delta', delta: 'Resposta da primeira.' });
    await mandar('segunda');

    emitir({ type: 'finish', more: true, usage: { totalTokens: 10 } });

    expect(painel._isStreaming).toBe(true);
    expect(api.startChat).toHaveBeenCalledTimes(1);
    // A sessao continua a mesma, senao os pacotes seguintes seriam descartados.
    expect(painel.currentSessionId).toBe(sessao(0));
    // O que ja tinha sido dito ficou gravado, e na ORDEM em que aconteceu: a
    // resposta da primeira pergunta vem antes da segunda pergunta, porque a
    // segunda so entra na conversa quando a assistente a aceita. Antes ela
    // entrava no instante em que era digitada, e ficava ANTES da resposta que
    // nem tinha interrompido, na tela e no historico.
    expect(painel.messages.map((m) => m.content))
      .toEqual(['primeira', 'Resposta da primeira.']);
    expect(bolhas().map((b) => b.texto))
      .toEqual(['primeira', 'Resposta da primeira.']);

    emitir({ type: 'follow-up-taken', content: 'segunda' });
    expect(painel.messages.map((m) => m.content))
      .toEqual(['primeira', 'Resposta da primeira.', 'segunda']);
    expect(bolhas().map((b) => b.texto))
      .toEqual(['primeira', 'Resposta da primeira.', 'segunda']);

    emitir({ type: 'text-delta', delta: 'Resposta da segunda.' });
    emitir({ type: 'finish' });

    expect(painel._isStreaming).toBe(false);
    expect(bolhas().at(-1).texto).toBe('Resposta da segunda.');
    expect(painel.messages.at(-1)).toEqual({ role: 'assistant', content: 'Resposta da segunda.' });
  });

  it('um cartao aberto sobrevive ao finish com `more`, porque a sessao nao acabou', async () => {
    api.pushChatMessage = vi.fn(async () => ({ ok: true, data: { accepted: true } }));
    await abrirPainel();
    await mandar('primeira');

    let respondeu = null;
    painel.showAskUserQuestionInline({ question: 'qual?', options: ['a', 'b'] })
      .then((r) => { respondeu = r; });
    await mandar('segunda');

    emitir({ type: 'finish', more: true });
    await Promise.resolve();

    expect(respondeu).toBeNull();     // o reset teria cancelado a pergunta
    expect(painel.pendingAskUserQuestions.size).toBe(1);
    expect(painel.messagesEl.querySelector('.ai-ask-question')).toBeTruthy();
  });

  it('a parada cancela o que estava enfileirado, e aborta pela sessao', async () => {
    await abrirPainel();
    await mandar('primeira');
    await mandar('segunda');
    const sid = sessao(0);

    await painel.stop();

    expect(api.chamadas.abort).toEqual([sid]);
    expect(painel._messageQueue).toEqual([]);
    expect(painel.queueEl.hidden).toBe(true);

    emitir({ type: 'aborted' });
    expect(painel._isStreaming).toBe(false);
    expect(api.startChat).toHaveBeenCalledTimes(1);   // a fila nao ressuscitou
  });
});

describe('quando o turno da errado', () => {
  it('mostra o erro e grava a ferramenta em voo como falhada', async () => {
    await abrirPainel();
    await mandar('compila');

    emitir({ type: 'tool-call', toolName: 'compile_all', args: { alvo: 'tudo' }, toolUseId: 't9' });
    emitir({ type: 'error', message: 'stream caiu' });

    const ultima = bolhas().at(-1);
    expect(ultima.erro).toBe(true);
    expect(ultima.texto).toContain('stream caiu');

    const ferramenta = painel.messages.find((m) => m.role === 'tool');
    expect(ferramenta).toMatchObject({
      toolName: 'compile_all', status: 'failed', toolUseId: 't9', args: { alvo: 'tudo' },
      error: 'stream caiu',
    });
    // O chip parado de girar na tela e o sintoma que isto impede.
    const chip = painel.messagesEl.querySelector('.ai-tool-chip');
    expect(chip.classList.contains('running')).toBe(false);
    expect(chip.classList.contains('failed')).toBe(true);

    expect(painel._isStreaming).toBe(false);
    expect(api.chamadas.salvos.at(-1)).toBeTruthy();
  });

  it('o cao de guarda resgata o turno que emudeceu, e nunca por cima de um cartao aberto', async () => {
    vi.useFakeTimers();
    await abrirPainel();
    await mandar('faz alguma coisa');

    // Com uma pergunta na tela esperando a pessoa, o silencio e legitimo: ela
    // pode levar o tempo que quiser, e resgatar ali mataria o proprio cartao.
    let respondeu = null;
    const pergunta = painel.showAskUserQuestionInline({ question: 'qual?', options: ['a', 'b'] });
    pergunta.then((r) => { respondeu = r; });
    await vi.advanceTimersByTimeAsync(STREAM_STALL_MS + 60000);
    expect(painel._isStreaming).toBe(true);
    expect(api.chamadas.abort).toEqual([]);

    // Fechado o cartao, o mesmo silencio vira travamento e o resgate acontece.
    painel.messagesEl.querySelector('.ai-askq-cancel').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(respondeu).toBeTruthy();

    const sid = painel.currentSessionId;
    await vi.advanceTimersByTimeAsync(STREAM_STALL_MS + 60000);
    expect(api.chamadas.abort).toEqual([sid]);
    expect(painel._isStreaming).toBe(false);
    expect(bolhas().at(-1).erro).toBe(true);
  });
});

describe('o turno que a propria assistente comeca', () => {
  it('para a corrente autonoma no sexto elo, com aviso na tela', async () => {
    await abrirPainel();
    await mandar('comeca');
    emitir({ type: 'finish' });

    for (let i = 0; i < 7; i++) {
      const antes = api.chamadas.startChat.length;
      painel.autoContinue(`tarefa ${i} terminou`, { label: 'Autonomous follow-up' });
      // `_drainAutoQueue` dispara `_dispatchTurn` sem esperar, entao o despacho
      // so existe alguns microtasks depois. Sem esta espera o caso passaria
      // verde com UM despacho, sem ter exercitado a corrente uma vez.
      if (api.chamadas.startChat.length === antes) {
        await vi.waitFor(() => expect(api.chamadas.startChat.length).toBeGreaterThan(antes), { timeout: 500 })
          .catch(() => { /* a trava fechou a corrente: nao ha novo despacho */ });
      }
      if (painel._isStreaming) emitir({ type: 'finish' }, api.chamadas.startChat.length - 1);
    }

    // Cinco elos autonomos despacham (o primeiro despacho e o da pessoa).
    expect(api.startChat).toHaveBeenCalledTimes(6);
    const aviso = bolhas().at(-1);
    expect(aviso.erro).toBe(true);
    expect(aviso.texto).toContain('chain limit');
  });

  /* ---------------- a citacao do manual, pelos dois caminhos ---------------- */

  describe('cite_manual vira citacao na tela', () => {
    // ESTE ARQUIVO EXISTE POR CAUSA DESTE BUG. A ferramenta rodava, o chip
    // dizia "done" e nenhuma citacao aparecia, porque o resultado chega em
    // DUAS formas e o coletor lia so uma:
    //
    //   pela API          { ok, data: { path, title, quote } }
    //   pela assinatura   { ok, content: '<o mesmo objeto em JSON>' }
    //
    // A segunda passa pelo servidor MCP, que so sabe devolver texto. Nenhum
    // teste cobria o caminho da assinatura, entao tudo passava e nada aparecia.
    const CITACAO = {
      path: 'avancado/dirac.html',
      title: 'Notacao de Dirac',
      quote: 'O tipo complexo e nativo da linguagem.',
      manualVersion: '6.4.2',
    };

    /** Emite o par tool-call/tool-result como o backend emite. */
    function citar(nome, result) {
      emitir({ type: 'tool-call', toolName: nome, args: {}, toolUseId: 't1' });
      emitir({ type: 'tool-result', toolName: nome, result, toolUseId: 't1' });
    }

    it('pelo caminho de API, com o objeto em `data`', async () => {
      await abrirPainel();
      await mandar('onde fala de Dirac?');
      citar('cite_manual', { ok: true, data: CITACAO });
      emitir({ type: 'finish' });

      const bloco = painel.messagesEl.querySelector('.ai-citacoes');
      expect(bloco, 'o bloco de citacao nao foi desenhado').toBeTruthy();
      expect(bloco.textContent).toContain(CITACAO.quote);
      expect(bloco.textContent).toContain(CITACAO.title);
    });

    it('pela assinatura, com o objeto SERIALIZADO em `content`', async () => {
      // O caso que quebrou. O servidor MCP faz JSON.stringify do resultado, e
      // a ponte da CLI entrega isso como texto.
      await abrirPainel();
      await mandar('onde fala de Dirac?');
      citar('mcp__aurora__cite_manual', {
        ok: true,
        content: JSON.stringify({ ok: true, data: CITACAO }),
      });
      emitir({ type: 'finish' });

      const bloco = painel.messagesEl.querySelector('.ai-citacoes');
      expect(bloco, 'o bloco nao apareceu pelo caminho da assinatura').toBeTruthy();
      expect(bloco.textContent).toContain(CITACAO.quote);
    });

    it('a citacao recusada nao vira nada na tela', async () => {
      // Recusa e assunto do modelo, que tem de reler a pagina. Mostrar uma
      // citacao vazia ou um erro aqui so confundiria quem le a resposta.
      await abrirPainel();
      await mandar('onde fala de Dirac?');
      citar('mcp__aurora__cite_manual', {
        ok: true,
        content: JSON.stringify({ ok: false, error: 'este texto nao existe nesta pagina' }),
      });
      emitir({ type: 'finish' });
      expect(painel.messagesEl.querySelector('.ai-citacoes')).toBeNull();
    });

    it('a mesma frase citada duas vezes vira uma linha so', async () => {
      // O modelo repete a citacao quando usa a mesma frase em duas afirmacoes.
      // Uma linha por frase, nao por uso.
      await abrirPainel();
      await mandar('onde fala de Dirac?');
      citar('cite_manual', { ok: true, data: CITACAO });
      citar('cite_manual', { ok: true, data: { ...CITACAO } });
      emitir({ type: 'finish' });

      expect(painel.messagesEl.querySelectorAll('.ai-citacao')).toHaveLength(1);
    });

    it('outra ferramenta qualquer nao vira citacao', async () => {
      await abrirPainel();
      await mandar('compila');
      citar('mcp__aurora__read_manual_page', {
        ok: true,
        content: JSON.stringify({ ok: true, data: { path: 'x.html', text: 'muito texto' } }),
      });
      emitir({ type: 'finish' });
      expect(painel.messagesEl.querySelector('.ai-citacoes')).toBeNull();
    });

    it('a citacao sobrevive a reabertura da conversa', async () => {
      // Ela entra no historico como registro de papel `citation`; sem o ramo
      // de releitura, reabrir a conversa a perderia em silencio.
      await abrirPainel();
      await mandar('onde fala de Dirac?');
      citar('cite_manual', { ok: true, data: CITACAO });
      emitir({ type: 'finish' });

      const guardada = painel.messages.find((m) => m.role === 'citation');
      expect(guardada, 'a citacao nao entrou no historico').toBeTruthy();
      expect(guardada.citacoes[0].trecho).toBe(CITACAO.quote);
      expect(guardada.citacoes[0].versao).toBe('6.4.2');
    });
  });

  /* ---------------- a operacao, que vira esforco no main ---------------- */

  describe('o turno diz QUE TIPO de tarefa e', () => {
    // Quem dispara sabe o que esta pedindo; o modelo nao. O rotulo viaja no
    // `startChat` e o main o traduz em esforco de raciocinio
    // (main/ai/effort_policy.js). Sem isto, toda tarefa paga o mesmo
    // raciocinio, e quem paga a conta e quem usa a AURORA.
    it('o botao Fix da selecao pede acharErros', async () => {
      await abrirPainel();
      painel.askAboutSelection({ code: 'x = 1;', intent: 'fix', send: true });
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(1));
      expect(api.chamadas.startChat[0].operacao).toBe('acharErros');
    });

    it('explicar, comentar e documentar caem na mesma linha da tabela', async () => {
      // A regra e o RACIOCINIO que a tarefa exige, e nao o nome do botao: os
      // tres sao leitura local de um trecho que ja esta na tela.
      for (const intent of ['explain', 'comment', 'doc']) {
        await abrirPainel();
        painel.askAboutSelection({ code: 'x = 1;', intent, send: true });
        await vi.waitFor(() => expect(api.chamadas.startChat.length).toBeGreaterThan(0));
        expect(api.chamadas.startChat.at(-1).operacao, intent).toBe('comentar');
      }
    });

    it('improve fica de fora de proposito, e vale o valor da interface', async () => {
      // Nao esta na tabela. Inventar uma linha aqui seria decidir o esforco
      // por quem paga sem ter motivo.
      await abrirPainel();
      painel.askAboutSelection({ code: 'x = 1;', intent: 'improve', send: true });
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(1));
      expect(api.chamadas.startChat[0].operacao).toBeUndefined();
    });

    it('o rotulo vale para UM envio, e nao contamina o seguinte', async () => {
      // Um campo esquecido aqui daria esforco de diagnostico a uma pergunta
      // qualquer digitada depois.
      await abrirPainel();
      painel.askAboutSelection({ code: 'x = 1;', intent: 'fix', send: true });
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(1));
      emitir({ type: 'finish' });
      await mandar('e agora?');
      expect(api.chamadas.startChat[1].operacao).toBeUndefined();
    });

    it('compilar que passou e compilar que falhou nao sao a mesma tarefa', async () => {
      await abrirPainel();
      await mandar('compila');
      emitir({ type: 'finish' });

      painel.autoContinue('deu certo', { label: 'ok', operacao: 'posCompilacaoOk' });
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(2));
      expect(api.chamadas.startChat[1].operacao).toBe('posCompilacaoOk');
      emitir({ type: 'finish' }, 1);

      painel.autoContinue('deu erro', { label: 'falhou', operacao: 'posCompilacaoFalha' });
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(3));
      expect(api.chamadas.startChat[2].operacao).toBe('posCompilacaoFalha');
    });

    it('a operacao viaja na fila, e nao num campo unico do painel', async () => {
      // Enfileirar duas enquanto um turno corre e o caso em que um campo
      // unico entregaria o rotulo de uma tarefa ao turno da outra.
      await abrirPainel();
      await mandar('compila');
      painel.autoContinue('primeira', { operacao: 'posCompilacaoOk' });
      painel.autoContinue('segunda', { operacao: 'posCompilacaoFalha' });
      expect(api.chamadas.startChat.length).toBe(1);   // a corrente espera o turno vivo

      emitir({ type: 'finish' });
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(2));
      expect(api.chamadas.startChat[1].operacao).toBe('posCompilacaoOk');
      emitir({ type: 'finish' }, 1);
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(3));
      expect(api.chamadas.startChat[2].operacao).toBe('posCompilacaoFalha');
    });
  });

  it('uma mensagem de gente zera a corrente, que e o que a trava protege', async () => {
    await abrirPainel();
    await mandar('comeca');
    emitir({ type: 'finish' });

    for (let i = 0; i < 3; i++) {
      const antes = api.chamadas.startChat.length;
      painel.autoContinue(`elo ${i}`);
      await vi.waitFor(() => expect(api.chamadas.startChat.length).toBe(antes + 1));
      emitir({ type: 'finish' }, api.chamadas.startChat.length - 1);
    }
    expect(painel._autoChainCount).toBe(3);

    await mandar('para, faz outra coisa');
    expect(painel._autoChainCount).toBe(0);
  });
});

// Os nomes de arquivo na resposta da IA viram link; o clique abre o arquivo do
// projeto, na linha quando ela veio. A regra de para onde o nome aponta e do
// js/ai/file_ref.ts (teste proprio); aqui, de onde vem a raiz e o que acontece
// quando o arquivo existe, nao existe ou nao abre.
describe('referencia a arquivo na resposta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.t;
    delete window.projectTreeManager;
  });

  it('procura o nome relativo na pasta do projeto e abre na linha', async () => {
    await abrirPainel();
    electronAPI.fileExists.mockImplementation(async (c) => c === 'C:/proj/src/top.v');
    electronAPI.readFile.mockResolvedValueOnce('module top;');
    await painel.openFileRef('src/top.v', 12);
    expect(electronAPI.fileExists).toHaveBeenCalledWith('C:/proj/src/top.v');
    expect(TabManager.addTab).toHaveBeenCalledWith('C:/proj/src/top.v', 'module top;', { revealPosition: { line: 12, column: 1 } });
  });

  it('um arquivo da arvore vence o caminho na pasta; sem linha, abre sem posicao', async () => {
    await abrirPainel();
    window.projectTreeManager = { verilogFiles: [{ name: 'top.v', path: 'D:/outro/top.v' }] };
    electronAPI.fileExists.mockResolvedValue(true);
    await painel.openFileRef('top.v', 0);
    expect(TabManager.addTab).toHaveBeenCalledWith('D:/outro/top.v', '', {});
  });

  it('candidato que falha ao conferir passa para o proximo; nenhum existe, avisa', async () => {
    await abrirPainel();
    electronAPI.fileExists.mockRejectedValue(new Error('x'));
    await painel.openFileRef('nada.v');
    expect(showCardNotification).toHaveBeenCalledWith('File not in project: nada.v', 'warning', 3000);
    window.t = (k, p) => `${k}:${p.name}`;
    await painel.openFileRef('nada.v');
    expect(showCardNotification).toHaveBeenLastCalledWith('notification.ai.fileNotFound:nada.v', 'warning', 3000);
  });

  it('arquivo que existe mas nao le avisa com o nome', async () => {
    await abrirPainel();
    electronAPI.fileExists.mockResolvedValue(true);
    electronAPI.readFile.mockRejectedValueOnce(new Error('travado'));
    await painel.openFileRef('src/top.v');
    expect(showCardNotification).toHaveBeenLastCalledWith('Could not open src/top.v', 'error', 3000);
    expect(TabManager.addTab).not.toHaveBeenCalled();
  });

  it('a raiz e a do projeto aberto no store, nao uma global sobrescrita', async () => {
    await abrirPainel();
    window.currentProjectPath = 'D:/outra-janela';
    electronAPI.fileExists.mockResolvedValue(false);
    await painel.openFileRef('src/top.v');
    expect(electronAPI.fileExists).toHaveBeenCalledWith('C:/proj/src/top.v');
  });
});
