/**
 * provedores_do_painel.ts: o popover de provedor e modelo do painel de IA.
 *
 * Quais provedores existem (as duas assinaturas sempre, os de API quando ha
 * chave), qual esta ativo, o modelo de cada um, o esforco, o modo de permissao,
 * a linha de estado da conexao e o uso da assinatura. O desenho puro de cada
 * pedaco mora em provider_view.ts e estado_do_provedor.ts, e os dados em
 * ai_metadata.ts; aqui fica a orquestracao com o estado do painel.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O painel continua dono do estado
 * (provedor ativo, entradas, sondas); cada funcao o recebe como contexto.
 */

import {
  PROVIDER_META, CLAUDE_CODE_PROVIDER, CLAUDE_CODE_EFFORT, CHATGPT_PROVIDER, CHATGPT_MODELS,
  SUB_META, isSubProvider, shortModelName, usageRowHTML, usageRows, formatPlanLabel,
  PERMISSION_STORE_KEY, PERMISSION_MODES,
  type EntradaDeProvedor, type MetaDoProvedor, type RelatorioDeUso,
} from './ai_metadata.js';
import { providerOptionsHtml, modelPresetsHtml, faithfulModelName } from './provider_view.js';
import { estadoDaAssinatura, estadoDoProvedor, type EstadoDaCli } from './estado_do_provedor.js';
import { permissionOptionsHtml } from './tool_permission.js';

/** O que o popover le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDosProvedores {
  currentProvider: string | null;
  providersAvailable: EntradaDeProvedor[];
  providersConfigured: Record<string, boolean>;
  claudeCodeEntry?: EntradaDeProvedor;
  chatgptEntry?: EntradaDeProvedor;
  permissionMode: string;
  claudeCodeEffort: string;
  modelPopoverOpen: boolean;
  subStatus: Record<string, EstadoDaCli | null>;
  subUsage: Record<string, RelatorioDeUso | null>;

  modelPopover: HTMLElement;
  modelChip: HTMLElement;
  modelChipIcon: HTMLImageElement;
  modelChipName: HTMLElement;
  providerIcon: HTMLImageElement;
  modelInput: HTMLInputElement | null;
  mpPerms: HTMLElement;
  mpProviders: HTMLElement;
  mpModelApi: HTMLElement;
  mpModelPresets: HTMLElement;
  ccSections: Iterable<Element> & { forEach(fn: (el: Element) => void): void };
  effortSection: HTMLElement | null;
  effortSeg: HTMLElement;
  ccStatusEl: HTMLElement | null;
  usageBars: HTMLElement | null;
  usagePlan: HTMLElement;
  mpUsage: HTMLElement;
  sendBtn: HTMLButtonElement;
  inputEl: HTMLTextAreaElement;

  modelResetBtn: HTMLElement;
  container: HTMLElement | null;

  showEmptyState(show: boolean): void;
  appendDivider(text: string): HTMLElement | null;
}

/** A sonda de estado ou de uso de uma CLI de assinatura, pelo nome do canal. */
type Sonda = () => Promise<{ status?: EstadoDaCli | null; usage?: RelatorioDeUso | null } | null | undefined>;
const sonda = (nome: string): Sonda | undefined => (window.aiAPI as unknown as Record<string, Sonda | undefined> | undefined)?.[nome];

const metaDe = (provider: string | null): Partial<MetaDoProvedor> => PROVIDER_META[provider as string] || {};
const entradaAtiva = (p: PainelDosProvedores) => p.providersAvailable.find((e) => e.name === p.currentProvider);

/** Abre ou fecha o popover; aberto numa assinatura, atualiza o uso. */
export function alternarPopover(p: PainelDosProvedores, force?: boolean): void {
  const open = force === undefined ? !p.modelPopoverOpen : force;
  p.modelPopoverOpen = open;
  p.modelPopover.classList.toggle('hidden', !open);
  p.modelChip.classList.toggle('active', open);
  if (open && isSubProvider(p.currentProvider)) atualizarUso(p);
}

export function desenharPermissoes(p: PainelDosProvedores): void {
  p.mpPerms.innerHTML = permissionOptionsHtml(PERMISSION_MODES, p.permissionMode);
}

/** Troca o modo de permissao; so os modos conhecidos, e guardado. */
export function definirPermissao(p: PainelDosProvedores, mode: string): void {
  if (!PERMISSION_MODES.some((m) => m.id === mode)) return;
  p.permissionMode = mode;
  try { localStorage.setItem(PERMISSION_STORE_KEY, mode); }
  catch (_) { /* gravar e melhor esforco */ }
}

/**
 * Rele os provedores. As duas assinaturas (Claude Code e ChatGPT) estao sempre
 * disponiveis e guardam o modelo localmente; os de API entram quando ha chave.
 * A escolha atual fica se continuar valida; senao, o primeiro de API, e sem
 * nenhum, o Claude Code.
 */
export async function atualizarProvedores(p: PainelDosProvedores): Promise<void> {
  if (!window.aiAPI) {
    p.showEmptyState(true);
    p.sendBtn.disabled = true;
    p.inputEl.disabled = true;
    return;
  }

  let providers: EntradaDeProvedor[] = [];
  try {
    const r = await window.aiAPI.listProviders();
    const s = await window.aiAPI.getKeyStatus();
    providers = r?.providers || [];
    p.providersConfigured = s?.configured || {};
  } catch (e) {
    console.warn('[ai-panel] refreshProviders failed:', e);
    providers = [];
    p.providersConfigured = {};
  }

  if (!p.claudeCodeEntry) {
    p.claudeCodeEntry = { ...CLAUDE_CODE_PROVIDER };
    try {
      const saved = localStorage.getItem(SUB_META['claude-code'].modelStoreKey);
      if (saved) p.claudeCodeEntry.model = saved;
    } catch (_) { /* modo privado */ }
  }
  if (!p.chatgptEntry) {
    p.chatgptEntry = { ...CHATGPT_PROVIDER };
    try {
      const key = SUB_META['chatgpt'].modelStoreKey;
      const saved = localStorage.getItem(key);
      // Um id guardado que saiu da lista de presets cai no padrao. Versoes
      // antigas ofereciam `gpt-5` e `gpt-5-codex`, que falham na autenticacao
      // por assinatura do ChatGPT ("model is not supported when using Codex
      // with a ChatGPT account"); o padrao evita o erro no primeiro turno.
      if (saved && CHATGPT_MODELS.some((m) => m.id === saved)) {
        p.chatgptEntry.model = saved;
      } else if (saved) {
        localStorage.removeItem(key);
        p.chatgptEntry.model = 'default';
      }
    } catch (_) { /* modo privado */ }
  }
  p.providersConfigured['claude-code'] = true;
  p.providersConfigured['chatgpt'] = true;

  const apiUsable = providers.filter((e) => p.providersConfigured[e.name]);
  p.providersAvailable = [p.claudeCodeEntry, p.chatgptEntry, ...apiUsable];

  p.showEmptyState(false);
  p.sendBtn.disabled = false;
  p.inputEl.disabled = false;

  if (!p.currentProvider ||
      !p.providersAvailable.some((e) => e.name === p.currentProvider)) {
    p.currentProvider = apiUsable[0]?.name || 'claude-code';
  }

  desenharProvedores(p);
  aplicarProvedor(p);
}

function desenharProvedores(p: PainelDosProvedores): void {
  p.mpProviders.innerHTML = providerOptionsHtml(p.providersAvailable, p.currentProvider);
}

/** Reflete o provedor ativo no icone, no chip, nos controles e no uso. */
export function aplicarProvedor(p: PainelDosProvedores): void {
  const meta = metaDe(p.currentProvider);
  const entry = entradaAtiva(p);
  const isSub = !!meta.subscription;

  if (meta.icon) p.providerIcon.src = meta.icon;
  atualizarChip(p);
  if (p.modelInput) p.modelInput.value = entry?.model || '';

  // As secoes de esforco e de uso sao das assinaturas.
  p.ccSections.forEach((el) => el.classList.toggle('hidden', !isSub));
  // O esforco aparece para toda ponte que o declara (Claude Code e Codex) e para
  // a API da Anthropic, que aceita o mesmo esforco (o main so o envia aos
  // modelos que o suportam).
  const sm = SUB_META[p.currentProvider as string];
  const temEsforco = (sm && sm.hasEffort) || p.currentProvider === 'anthropic';
  if (p.effortSection) {
    p.effortSection.classList.toggle('hidden', !temEsforco);
  }

  desenharModelos(p);
  if (temEsforco && !isSub) desenharEsforco(p);
  if (isSub) {
    if (sm && sm.hasEffort) desenharEsforco(p);
    atualizarEstadoDaAssinatura(p);
    atualizarUso(p);
  } else {
    // Provedor de API: a linha de estado sai do mapa de chaves ja carregado.
    desenharEstadoDoProvedor(p);
  }
}

/** Troca o provedor ativo (radio do popover), marca a troca na conversa e fecha o popover. */
export function escolherProvedor(p: PainelDosProvedores, name: string): void {
  if (name === p.currentProvider) return;
  p.currentProvider = name;
  aplicarProvedor(p);
  marcarTrocaDeModelo(p);
  // Escolher a IA e a ultima coisa que a pessoa quer do popover: fecha, e ela
  // volta direto ao composer.
  alternarPopover(p, false);
}

/**
 * O divisor `Modelo: <provedor> · <modelo>` na conversa, a cada troca de
 * provedor ou de modelo: deixa claro qual modelo deu quais respostas.
 */
function marcarTrocaDeModelo(p: PainelDosProvedores): void {
  const meta = metaDe(p.currentProvider);
  const entry = entradaAtiva(p);
  const label = meta.label || p.currentProvider || 'Model';
  const model = faithfulModelName(entry, p.currentProvider);
  const el = p.appendDivider(model ? `Modelo: ${label} · ${model}` : `Modelo: ${label}`);
  // Este marcador desenha uma onda no lugar das linhas retas.
  el?.classList.add('ai-divider-wave');
}

/** O seletor de modelo: campo livre para provedor de API, botoes para as CLIs. */
function desenharModelos(p: PainelDosProvedores): void {
  const sm = SUB_META[p.currentProvider as string];
  p.mpModelApi.classList.toggle('hidden', !!sm);
  p.mpModelPresets.classList.toggle('hidden', !sm);
  if (sm) {
    const active = entradaAtiva(p)?.model || 'default';
    p.mpModelPresets.innerHTML = modelPresetsHtml(sm.models, active);
  }
}

/** O controle segmentado de esforco. */
function desenharEsforco(p: PainelDosProvedores): void {
  p.effortSeg.innerHTML = CLAUDE_CODE_EFFORT.map((e) =>
    `<button type="button" data-effort="${e.id}" class="ai-seg-btn${
      e.id === p.claudeCodeEffort ? ' active' : ''}">${e.label}</button>`).join('');
}

/** Troca o esforco; so os valores conhecidos, e guardado. */
export function definirEsforco(p: PainelDosProvedores, id: string): void {
  if (!CLAUDE_CODE_EFFORT.some((e) => e.id === id)) return;
  p.claudeCodeEffort = id;
  try { localStorage.setItem('aurora-ai-cc-effort', id); }
  catch (_) { /* melhor esforco */ }
  desenharEsforco(p);
}

/**
 * Grava o modelo do provedor ativo. Assinatura: local, vazio e o padrao.
 * Provedor de API: vai para o main, e vale o que ele responder; recusa ou
 * falha deixam o modelo como estava. A troca so e marcada se o modelo mudou.
 */
export async function gravarModelo(p: PainelDosProvedores, value: string): Promise<void> {
  const v = (value || '').trim();
  const entry = entradaAtiva(p);
  const before = entry?.model || '';

  const sm = SUB_META[p.currentProvider as string];
  if (sm) {
    const model = v || 'default';
    if (entry) entry.model = model;
    try { localStorage.setItem(sm.modelStoreKey, model); }
    catch (_) { /* melhor esforco */ }
    desenharModelos(p);
    atualizarChip(p);
    if (model !== before) marcarTrocaDeModelo(p);
    return;
  }

  try {
    const r = await (window.aiAPI as AuroraAiAPIComModelo).setModel(p.currentProvider as string, v);
    if (r && r.ok) {
      if (entry) entry.model = r.model || '';
      if (p.modelInput) p.modelInput.value = r.model || '';
    }
  } catch (_) { /* o campo fica como a pessoa digitou */ }
  atualizarChip(p);
  desenharProvedores(p);   // a dica de modelo de cada provedor
  if ((entry?.model || '') !== before) marcarTrocaDeModelo(p);
}

type AuroraAiAPIComModelo = { setModel(provider: string, model: string): Promise<{ ok?: boolean; model?: string } | null | undefined> };

/** O chip do composer: o icone do provedor e o nome curto do modelo. */
function atualizarChip(p: PainelDosProvedores): void {
  const meta = metaDe(p.currentProvider);
  const entry = entradaAtiva(p);
  if (meta.icon) p.modelChipIcon.src = meta.icon;

  const short = shortModelName(entry?.model);
  p.modelChipName.textContent = short || meta.label || p.currentProvider || 'Model';
  p.modelChip.title = entry?.model
    ? `${meta.label || p.currentProvider} · ${entry.model}`
    : `${meta.label || p.currentProvider} — switch model or provider`;
}

/** Sonda a instalacao e o login da CLI de assinatura ativa. */
export async function atualizarEstadoDaAssinatura(p: PainelDosProvedores): Promise<void> {
  const provider = p.currentProvider as string;
  const sm = SUB_META[provider];
  if (!sm) return;
  let status: EstadoDaCli | null = null;
  try {
    const r = await sonda(sm.statusApi)?.();
    status = r?.status || null;
  } catch (_) { /* conta como nao instalada */ }
  p.subStatus[provider] = status;
  // A pessoa pode ter trocado de provedor enquanto a sonda corria.
  if (p.currentProvider === provider) desenharEstadoDaAssinatura(p);
}

/** A linha de estado da assinatura (estado_do_provedor.ts). */
export function desenharEstadoDaAssinatura(p: PainelDosProvedores): void {
  if (!p.ccStatusEl) return;
  const sm = SUB_META[p.currentProvider as string];
  if (!sm) return;
  const { state, html } = estadoDaAssinatura(
    p.subStatus[p.currentProvider as string], sm, metaDe(p.currentProvider));
  p.ccStatusEl.dataset.state = state;
  p.ccStatusEl.innerHTML = html;
}

/** A linha de estado de um provedor de API (estado_do_provedor.ts). */
export function desenharEstadoDoProvedor(p: PainelDosProvedores): void {
  if (!p.ccStatusEl) return;
  const provider = p.currentProvider as string;
  const { state, html } = estadoDoProvedor(
    provider,
    metaDe(provider),
    p.providersAvailable.find((e) => e.name === provider),
    !!(p.providersConfigured && p.providersConfigured[provider]),
  );
  p.ccStatusEl.dataset.state = state;
  p.ccStatusEl.innerHTML = html;
}

/** Sonda o uso da assinatura ativa e o desenha, se ela ainda for a ativa. */
export async function atualizarUso(p: PainelDosProvedores): Promise<void> {
  const provider = p.currentProvider as string;
  const sm = SUB_META[provider];
  if (!sm) return;
  let usage: RelatorioDeUso | null = null;
  try {
    const r = await sonda(sm.usageApi)?.();
    usage = r?.usage || null;
  } catch (_) { /* uso fica vazio */ }
  p.subUsage[provider] = usage;
  if (p.currentProvider === provider) desenharUso(p);
}

/** As barras de uso, o plano e a dica quando ainda nao ha janelas de limite. */
export function desenharUso(p: PainelDosProvedores): void {
  if (!p.usageBars) return;
  const u = p.subUsage[p.currentProvider as string];

  p.usagePlan.textContent = u?.plan ? `${formatPlanLabel(u.plan)} plan` : '';

  // A decisao (recorte da utilizacao, limiar de cor, segundo contra
  // milissegundo no resetsAt) vive em ai_metadata.usageRows, com teste.
  p.usageBars.innerHTML = usageRows(u)
    .map((l) => usageRowHTML(l.label, l.icon, l.valText, l.sev, l.pct))
    .join('');

  const windows = Array.isArray(u?.windows) ? (u as RelatorioDeUso).windows as unknown[] : [];
  let hint = p.mpUsage.querySelector('.ai-usage-hint');
  if (!windows.length) {
    // A CLI do Codex so expoe a contagem de tokens da sessao, nunca as janelas
    // de limite, entao "aparece depois da primeira mensagem" seria mentira la.
    const text = p.currentProvider === 'chatgpt'
      ? 'The Codex CLI reports only this session’s token tally, not ChatGPT plan limits.'
      : 'Plan limits appear here after your first message.';
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'ai-usage-hint';
      p.mpUsage.appendChild(hint);
    }
    hint.textContent = text;
  } else if (hint) {
    hint.remove();
  }
}

/**
 * Liga os controles do popover: o chip que o abre, clicar fora que o fecha, os
 * radios de provedor e de permissao, o campo e os botoes de modelo, o esforco,
 * o "conferir de novo" da assinatura e o atalho para as chaves nas
 * Configuracoes. Mudar a chave ou o modelo nas Configuracoes rele os provedores.
 */
export function ligarPopover(p: PainelDosProvedores): void {
  p.modelChip.addEventListener('click', (e) => {
    e.stopPropagation();
    alternarPopover(p);
  });
  p.modelPopover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => alternarPopover(p, false));

  window.addEventListener('aurora-ai-settings-changed', () => atualizarProvedores(p));

  p.mpProviders.addEventListener('change', (e) => {
    const radio = (e.target as Element).closest<HTMLInputElement>('input[name="ai-provider"]');
    if (radio) escolherProvedor(p, radio.value);
  });
  p.mpPerms.addEventListener('change', (e) => {
    const radio = (e.target as Element).closest<HTMLInputElement>('input[name="ai-perm"]');
    if (radio) definirPermissao(p, radio.value);
  });

  // O modelo de um provedor de API, em texto livre, grava no Enter ou ao sair.
  const campo = p.modelInput as HTMLInputElement;
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); campo.blur(); }
  });
  campo.addEventListener('change', () => gravarModelo(p, campo.value));
  p.modelResetBtn.addEventListener('click', () => {
    const meta = p.providersAvailable.find((e) => e.name === p.currentProvider);
    gravarModelo(p, meta?.defaultModel || '');
  });

  // Os botoes de modelo das assinaturas.
  p.mpModelPresets.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('button[data-model]');
    if (btn) gravarModelo(p, btn.dataset.model as string);
  });

  // O esforco (controle segmentado).
  p.effortSeg.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('button[data-effort]');
    if (btn) definirEsforco(p, btn.dataset.effort as string);
  });

  // O "conferir de novo" da linha de estado da assinatura.
  (p.ccStatusEl as HTMLElement).addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-cc-recheck]')) atualizarEstadoDaAssinatura(p);
  });

  (p.container as HTMLElement).querySelector('#ai-mp-managekeys')?.addEventListener('click', () => {
    alternarPopover(p, false);
    document.getElementById('aurora-settings')?.click();
    // Direto para o painel de IA quando o modal estiver de pe.
    setTimeout(() => {
      document.querySelector<HTMLElement>('.settings-nav-item[data-pane="ai"]')?.click();
    }, 60);
  });
}
