/**
 * api_core.js — o envelope de resposta e o barramento de eventos da AuroraAPI.
 *
 * Extraido de js/api/aurora_api.js em 08/08/2026, sem mudanca de comportamento.
 *
 * O motivo e o mesmo que mantinha esse arquivo sem nenhum teste: importar o
 * aurora_api.js INICIALIZA a IDE. A cadeia de imports dele chega ao tab_manager,
 * que se auto-inicializa em tempo de carga e chama IPC que nao existe fora do
 * Electron, entao um teste nao conseguia nem carregar o modulo. E a fragilidade
 * dos construtores que fazem I/O, descrita na secao 8 do ARCHITECTURE.md.
 *
 * Este modulo nao importa nada. E isso que o torna testavel e que faz dele o
 * lugar certo para o nucleo: toda resposta das ferramentas chamaveis pela IA
 * sai por `ok` ou `err`, e o modelo decide o proximo passo lendo esse formato.
 */

/**
 * Resposta de sucesso.
 *
 * `undefined` vira `null` de proposito: o JSON.stringify do IPC descarta chave
 * com valor undefined, e a chave `data` sumiria da mensagem que chega ao
 * modelo. Valor falso que NAO e undefined e preservado, porque `false`, `0` e
 * `''` sao respostas legitimas de ferramenta.
 */
export function ok(data) {
  return { ok: true, data: data === undefined ? null : data };
}

/**
 * Resposta de erro. A mensagem e sempre string, porque um Error nao sobrevive
 * ao JSON do IPC, e o codigo ausente vira null em vez de undefined pelo mesmo
 * motivo do `ok`.
 */
export function err(message, code) {
  return {
    ok: false,
    error: { message: String(message || 'Unknown error'), code: code || null },
  };
}

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

/**
 * Assina um evento. Devolve a funcao que cancela a assinatura, de modo que quem
 * assina nao precise guardar a referencia para desassinar depois.
 */
export function on(event, fn) {
  if (typeof fn !== 'function') return () => {};
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

/**
 * Publica um evento. Ouvinte que lanca e registrado e ignorado: um painel com
 * defeito nao pode calar os eventos do resto da IDE.
 */
export function emit(event, payload) {
  const subs = listeners.get(event);
  if (!subs) return;
  for (const fn of subs) {
    try { fn(payload); }
    catch (e) { console.warn(`[AuroraAPI.events] handler for "${event}" threw:`, e); }
  }
}

/**
 * Ponte dos eventos legados.
 *
 * A AURORA e anterior a este barramento, entao sinais transversais ainda saem
 * como CustomEvent no `window`. Em vez de migrar todo publicador de uma vez,
 * cada evento legado e reemitido no barramento sob um nome normalizado com
 * dois-pontos. Quem usa `window.addEventListener` continua funcionando, e o
 * codigo novo, incluindo a Aurora Intelligence, ve uma superficie so.
 */
export const WINDOW_EVENT_BRIDGE = Object.freeze({
  'aurora:locale-changed': 'locale:changed',
  'aurora:editing-file-changed': 'editor:active-file-changed',
  'aurora-editor-focused': 'editor:focused',
  'aurora:spf-changed': 'project:spf-changed',
  'aurora-settings-updated': 'settings:updated',
  'aurora-shortcuts-updated': 'settings:shortcuts-updated',
  'aurora-tooltips-updated': 'settings:tooltips-updated',
});
