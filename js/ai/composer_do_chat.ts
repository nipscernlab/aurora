/**
 * composer_do_chat.ts: os ouvintes do campo de mensagem do painel de IA.
 *
 * Enviar pelo botao ou pelo Enter (Shift+Enter quebra a linha), parar o turno,
 * crescer o campo com o texto, e anexar arquivo pelo clipe, arrastando ou
 * colando. O que cada gesto faz (mandar, enfileirar, ler o anexo) continua no
 * painel e em anexos_do_chat.ts; aqui fica a ligacao.
 *
 * Saiu do attachListeners do ai_assistant_manager.js (TODO 13.3).
 */

/** O que o composer liga no painel (js/ui/ai_assistant_manager.js). */
export interface PainelDoComposer {
  sendBtn: HTMLButtonElement;
  stopBtn: HTMLElement;
  inputEl: HTMLTextAreaElement;
  attachBtn: HTMLElement | null;
  attachInput: HTMLInputElement | null;
  composerEl: HTMLElement | null;
  send(): unknown;
  stop(): unknown;
  autoGrowInput(): void;
  _addFiles(files: ArrayLike<File> | File[]): unknown;
}

export function ligarComposer(p: PainelDoComposer): void {
  p.sendBtn.addEventListener('click', () => p.send());

  // O clipe abre o seletor; o seletor e limpo depois, para o mesmo arquivo
  // poder ser escolhido de novo.
  p.attachBtn?.addEventListener('click', () => p.attachInput?.click());
  p.attachInput?.addEventListener('change', () => {
    p._addFiles((p.attachInput as HTMLInputElement).files as FileList);
    (p.attachInput as HTMLInputElement).value = '';
  });

  // Arrastar arquivo acende o composer; soltar anexa. Arrastar outra coisa
  // (texto, um link) segue o comportamento normal da pagina.
  const stopDrag = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach((t) => p.composerEl?.addEventListener(t, (e) => {
    if ((e as DragEvent).dataTransfer?.types?.includes('Files')) { stopDrag(e); (p.composerEl as HTMLElement).classList.add('drag-over'); }
  }));
  ['dragleave', 'dragend', 'drop'].forEach((t) => p.composerEl?.addEventListener(t, (e) => {
    stopDrag(e); (p.composerEl as HTMLElement).classList.remove('drag-over');
  }));
  p.composerEl?.addEventListener('drop', (e) => {
    const files = (e as DragEvent).dataTransfer?.files;
    if (files?.length) p._addFiles(files);
  });

  // Colar arquivo anexa e nao cola nada no campo; colar so texto segue normal.
  p.inputEl.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
    }
    if (files.length) { e.preventDefault(); p._addFiles(files); }
  });

  p.stopBtn.addEventListener('click', () => p.stop());

  // Enter manda, Shift+Enter quebra a linha. O Enter NAO depende de haver turno
  // correndo: o send decide entre despachar e enfileirar, e travar aqui deixava
  // a fila inalcancavel pelo teclado. O que trava de verdade (nenhum provedor)
  // e o sendBtn desabilitado.
  p.inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!p.sendBtn.disabled) p.send();
    }
  });

  // O campo cresce com o texto (ate um teto, depois rola).
  p.inputEl.addEventListener('input', () => p.autoGrowInput());
}

/** O que o "perguntar sobre a selecao" usa do painel. */
export interface PainelDaSelecao {
  inputEl: HTMLTextAreaElement | null;
  _isStreaming?: boolean;
  _operacaoDoProximoEnvio?: string | null;
  ensureOpen(): void;
  autoGrowInput?(): void;
  send(): unknown;
}

/** O pedido do botao de estrela do editor (window.AuroraAPI.ai.askAboutSelection). */
export interface PedidoSobreSelecao {
  code?: string; language?: string; filePath?: string;
  lineStart?: number; lineEnd?: number; intent?: string; send?: boolean;
}

const INTENT_LEAD: Record<string, string> = {
  explain: 'Explain what this code does',
  fix: 'Find and fix any bugs in this code',
  improve: 'Improve and refactor this code',
  comment: 'Add clear, concise comments to this code',
  doc: 'Write documentation for this code',
};

// Do botao para a operacao, e dai para o esforco. A regra e o RACIOCINIO que a
// tarefa exige, e nao o nome do botao: explicar, comentar e documentar sao a
// mesma leitura local de um trecho que ja esta na tela. `fix` e o oposto, exige
// simular a execucao e comparar hipoteses. `improve` fica de fora de proposito:
// vale o esforco que a pessoa escolheu na interface.
const OPERACAO_DO_INTENT: Record<string, string> = {
  explain: 'comentar',
  comment: 'comentar',
  doc: 'comentar',
  fix: 'acharErros',
};

/**
 * Abre o painel e poe no composer o trecho que a pessoa selecionou no editor,
 * citado, com o arquivo e as linhas. Com uma intencao e `send`, o pedido sai na
 * hora; sem intencao, o cursor fica no comeco para a pessoa escrever a
 * pergunta em cima do trecho. Texto ja digitado no composer nao e apagado.
 */
export function perguntarSobreSelecao(
  p: PainelDaSelecao,
  { code = '', language = '', filePath = '', lineStart = 0, lineEnd = 0, intent = '', send = false }: PedidoSobreSelecao = {},
): void {
  const snippet = String(code || '').replace(/\s+$/, '');
  if (!snippet) return;
  p.ensureOpen();
  /* v8 ignore next */ // ensureOpen monta o painel, e com ele o campo
  if (!p.inputEl) return;
  const input = p.inputEl;

  const fileName = filePath ? String(filePath).split(/[\\/]/).pop() : '';
  const lineRef = lineStart && lineEnd
    ? (lineStart === lineEnd ? `line ${lineStart}` : `lines ${lineStart}–${lineEnd}`)
    : '';
  const where = fileName
    ? `\`${fileName}\`${lineRef ? ` (${lineRef})` : ''}`
    : (lineRef || 'the selection');

  const lead = INTENT_LEAD[intent] || '';
  const fence = '```' + (language || '');
  const body = `${lead ? lead + ' ' : ''}from ${where}:\n\n${fence}\n${snippet}\n\`\`\`\n`;

  const existing = input.value;
  input.value = existing && !send ? `${existing.replace(/\s*$/, '')}\n\n${body}` : body;
  p.autoGrowInput?.();
  input.focus();
  if (lead && send && !p._isStreaming) {
    p._operacaoDoProximoEnvio = OPERACAO_DO_INTENT[intent] || null;
    p.send();
  } else if (!lead) {
    try { input.setSelectionRange(0, 0); } catch (_) { /* ainda sem foco */ }
  }
}
