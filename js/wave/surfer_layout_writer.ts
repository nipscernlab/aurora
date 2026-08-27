/**
 * surfer_layout_writer.ts: emite um state file do Surfer (.surf.ron) pra o
 * viewer Surfer abrir JA com uma curadoria de sinais (cores, formatos,
 * aliases, analogico). E a contraparte DECLARATIVA do .gtkw que o
 * gtkw_proc_writer gera pro GTKWave.
 *
 * Por que .surf.ron e nao um command-file .sucl: o .sucl nao consegue montar
 * grupos curados, nao seta display analogico, e o targeting por-item (item_focus
 * por um indice base-16 minusculo fragil) erra silenciosamente. O .surf.ron e
 * declarativo, cada item carrega sua propria cor/formato/analog/nome, e o
 * Surfer RE-RESOLVE os itens por caminho hierarquico + nome no load (os IDs
 * Wellen sao dica de performance, recomputados), entao um state gerado com IDs
 * placeholder fica portavel entre re-runs. Lancado por `surfer <vcd> -s <file>`.
 *
 * Este modulo e a CAMADA DE FORMATO (buildSurferState): transforma uma lista
 * ordenada de itens em RON valido. A CAMADA DE CURADORIA (quais sinais, quais
 * cores/formatos, reusando detectProcessors etc. do gtkw_proc_writer) alimenta
 * esta. Compilado por tsc -> surfer_layout_writer.js (carregado pelo runtime).
 */

import { monitorMirrorName } from './signal_parser.js';
import { detectProcessors, resolveScopeModules, buildSignedSet } from './gtkw_proc_writer.js';
import type { VcdScope } from './vcd_parser.js';
import type { ModuleInfo } from './signal_parser.js';

/** Cores nomeadas do tema do Surfer (default_theme.toml [colors]). */
export type SurferColor =
  | 'Green' | 'Red' | 'Yellow' | 'Blue' | 'Pink' | 'Orange' | 'Gray' | 'Violet';

/** Display analogico de um sinal (campo `analog` do displayed_item). */
export interface SurferAnalog {
  renderStyle: 'Step' | 'Interpolated';
  yAxisScale: 'TypeLimits' | 'Global' | 'Viewport';
}

export interface SurferVariableItem {
  kind: 'variable';
  /** Componentes da hierarquia do scope desde a raiz da sim, ex.: ["tb","dut","proc"]. */
  scope: string[];
  /** Nome cru do sinal (sem scope, sem range). */
  name: string;
  /** Label visivel sobrescrito (alias). Null/omit = nome automatico. */
  manualName?: string | null;
  /** Nome do translator: "Hexadecimal" | "Signed" | um mapping como "trad_opcode". Null/omit = default do Surfer. */
  format?: string | null;
  color?: SurferColor | null;
  backgroundColor?: SurferColor | null;
  heightScale?: number | null;
  analog?: SurferAnalog | null;
}

export interface SurferDividerItem {
  kind: 'divider';
  /** Texto do cabecalho de secao (multi-palavra OK, ao contrario do .sucl). */
  name?: string | null;
  /** Cor do texto do divider (None = cor default do tema). O Surfer ja
   *  renderiza divider em italico; a cor e ADICIONAL pra destacar os labels. */
  color?: SurferColor | null;
}

export interface SurferTimelineItem {
  kind: 'timeline';
  name?: string | null;
}

/**
 * Grupo colapsavel (DisplayedItem::Group do Surfer). Os filhos NAO sao listados
 * em `content`, confirmado contra o save nativo do Surfer v0.7.0 (scope_add_as_
 * group serializa `content: []`): a hierarquia e definida SO pelos `level` do
 * items_tree (filhos vem logo apos o no do grupo com level+1). `isOpen` espelha
 * o `unfolded` do no (true = expandido). Suporta aninhamento (grupo em grupo).
 */
export interface SurferGroupItem {
  kind: 'group';
  /** Nome do header do grupo (obrigatorio no Surfer, String, nao Option). */
  name: string;
  color?: SurferColor | null;
  backgroundColor?: SurferColor | null;
  /** Estado dobrado: true = expandido (filhos visiveis). Default true. */
  isOpen?: boolean;
  children: SurferItem[];
}

export type SurferItem = SurferVariableItem | SurferDividerItem | SurferTimelineItem | SurferGroupItem;

export interface BuildSurferStateInput {
  /** Path absoluto do waveform; o VCD posicional da CLI o sobrescreve, entao e so dica. */
  vcdPath: string;
  /** 'Vcd' | 'Fst', o Surfer magic-detecta de qualquer jeito; default 'Vcd'. */
  sourceFormat?: 'Vcd' | 'Fst';
  items: SurferItem[];
  /**
   * Marcadores automaticos, ex.: [entrada, saida] pra medir latencia. O tempo
   * e' em unidades do timescale, o `#N` cru do dump; o rotulo e' o que aparece
   * na coluna da janela de Markers. Vazio/omit = sem markers.
   */
  markers?: SurferMarker[];
  /** Abre a janela de Markers do Surfer (a que mostra o delta entre eles). */
  showCursorWindow?: boolean;
}

/** Um marcador automatico: onde crava e como se chama. */
export interface SurferMarker {
  time: number;
  /** Nome mostrado na janela de Markers. Sem nome, o Surfer mostra so o indice. */
  label?: string | null;
}

// --- helpers de RON ---------------------------------------------------------

/** String literal RON com backslash + aspas escapados. */
function ronStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Option<String> RON: None / Some("..."). */
function ronOptStr(s: string | null | undefined): string {
  return (s === null || s === undefined) ? 'None' : `Some(${ronStr(s)})`;
}

/** Float RON (precisa de ponto decimal). */
function ronFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** Option<f32> RON: None / Some(8.0). */
function ronOptFloat(n: number | null | undefined): string {
  return (n === null || n === undefined) ? 'None' : `Some(${ronFloat(n)})`;
}

/** Campo `analog` RON: None / Some((settings: (render_style: .., y_axis_scale: ..))). */
function ronAnalog(a: SurferAnalog | null | undefined): string {
  if (!a) return 'None';
  return `Some((\n`
    + `                    settings: (\n`
    + `                        render_style: ${a.renderStyle},\n`
    + `                        y_axis_scale: ${a.yAxisScale},\n`
    + `                    ),\n`
    + `                ))`;
}

// --- emissores --------------------------------------------------------------

interface TreeNode { ref: number; level: number; unfolded: boolean }

function emitItemsTree(nodes: TreeNode[]): string {
  const rows = nodes.map((n) =>
    `                (\n`
    + `                    item_ref: (${n.ref}),\n`
    + `                    level: ${n.level},\n`
    + `                    unfolded: ${n.unfolded},\n`
    + `                    selected: false,\n`
    + `                ),`,
  ).join('\n');
  return `        items_tree: (\n            items: [\n${rows}\n            ],\n        ),`;
}

function emitVariable(ref: number, item: SurferVariableItem, scopeId: number, varId: number): string {
  const strs = item.scope.map((s) => `                            ${ronStr(s)},`).join('\n');
  return `            (${ref}): Variable((\n`
    + `                variable_ref: (\n`
    + `                    path: (\n`
    + `                        strs: [\n${strs}\n                        ],\n`
    + `                        id: Wellen((${scopeId})),\n`
    + `                    ),\n`
    + `                    name: ${ronStr(item.name)},\n`
    + `                    id: Wellen((${varId})),\n`
    + `                    index: None,\n`
    + `                ),\n`
    + `                color: ${ronOptStr(item.color)},\n`
    + `                background_color: ${ronOptStr(item.backgroundColor)},\n`
    + `                display_name: ${ronStr(item.name)},\n`
    + `                display_name_type: Unique,\n`
    + `                manual_name: ${ronOptStr(item.manualName)},\n`
    + `                format: ${ronOptStr(item.format)},\n`
    + `                field_formats: [],\n`
    + `                height_scaling_factor: ${ronOptFloat(item.heightScale)},\n`
    + `                analog: ${ronAnalog(item.analog)},\n`
    + `            )),`;
}

function emitDivider(ref: number, item: SurferDividerItem): string {
  return `            (${ref}): Divider((\n`
    + `                color: ${ronOptStr(item.color)},\n`
    + `                background_color: None,\n`
    + `                name: ${ronOptStr(item.name)},\n`
    + `            )),`;
}

function emitTimeline(ref: number, item: SurferTimelineItem): string {
  return `            (${ref}): TimeLine((\n`
    + `                color: None,\n`
    + `                background_color: None,\n`
    + `                name: ${ronOptStr(item.name)},\n`
    + `            )),`;
}

/**
 * Teto de marcadores. O `idx` do Surfer e' um u8 e o proprio `add_marker` dele
 * varre `0..=MAX_MARKER_INDEX`, que la vale 254. A AURORA crava dois (entrada e
 * saida), entao o teto e' folga, nao limite de uso.
 */
const MAX_MARKERS = 255;

/**
 * DisplayedItem::Marker, a metade VISIVEL de um marcador. O `idx` amarra este
 * item ao tempo guardado no mapa `markers`; `name` e o rotulo da coluna na
 * janela de Markers, e sem ele o Surfer mostra so o numero.
 */
function emitMarker(ref: number, idx: number, name: string | null): string {
  return `            (${ref}): Marker((\n`
    + `                color: None,\n`
    + `                background_color: None,\n`
    + `                name: ${ronOptStr(name)},\n`
    + `                idx: ${idx},\n`
    + `            )),`;
}

/**
 * DisplayedItem::Group. `name` e String (sempre Some-less). `content: []` SEMPRE
 *, a hierarquia vem dos `level` do items_tree, nao desta lista (ground truth do
 * save nativo do Surfer). `is_open` = estado dobrado persistido.
 */
function emitGroup(ref: number, item: SurferGroupItem): string {
  return `            (${ref}): Group((\n`
    + `                name: ${ronStr(item.name)},\n`
    + `                color: ${ronOptStr(item.color)},\n`
    + `                background_color: ${ronOptStr(item.backgroundColor)},\n`
    + `                content: [],\n`
    + `                is_open: ${item.isOpen ?? true},\n`
    + `            )),`;
}

/**
 * Constroi o conteudo completo de um .surf.ron a partir de uma lista ORDENADA
 * de itens. Cada item vira uma linha do items_tree (na ordem dada) + uma
 * entrada no displayed_items. Refs sao 1-based pela posicao. IDs Wellen sao
 * placeholders sequenciais (re-resolvidos por nome no load).
 *
 * Retorna o texto do arquivo (terminando em newline).
 */
export function buildSurferState(input: BuildSurferStateInput): string {
  const fmt = input.sourceFormat || 'Vcd';

  // Travessia depth-first IN-ORDER: refs sequenciais na ordem de visita; o no de
  // um grupo vem ANTES dos filhos, que ganham level+1 (formato nativo do Surfer).
  const scopeIds = new Map<string, number>();
  let nextScopeId = 1;
  let nextVarId = 1;
  let nextRef = 1;
  const nodes: TreeNode[] = [];
  const entries: string[] = [];

  const visit = (item: SurferItem, level: number): number => {
    const ref = nextRef++;
    if (item.kind === 'group') {
      nodes.push({ ref, level, unfolded: item.isOpen ?? true });
      for (const child of item.children) visit(child, level + 1);
      entries.push(emitGroup(ref, item));
    } else if (item.kind === 'variable') {
      nodes.push({ ref, level, unfolded: true });
      const key = item.scope.join(' ');
      let sid = scopeIds.get(key);
      if (sid === undefined) { sid = nextScopeId++; scopeIds.set(key, sid); }
      entries.push(emitVariable(ref, item, sid, nextVarId++));
    } else if (item.kind === 'divider') {
      nodes.push({ ref, level, unfolded: true });
      entries.push(emitDivider(ref, item));
    } else {
      nodes.push({ ref, level, unfolded: true });
      entries.push(emitTimeline(ref, item));
    }
    return ref;
  };

  for (const item of input.items) visit(item, 0);

  // Um marcador do Surfer sao DUAS metades, e emitir so uma nao produz metade do
  // efeito: produz efeito nenhum. O mapa `markers` guarda o tempo por indice,
  // mas quem desenha a caixa numerada na tela (`draw_marker_number_boxes`) e
  // quem monta a lista da janela (`draw_marker_window`) percorrem o
  // `items_tree` atras de `DisplayedItem::Marker`. Sem esse item o tempo fica
  // no arquivo sem nada aparecer, e era esse o estado: a janela de Markers
  // abria a cada simulacao e abria VAZIA. O proprio `add_marker` do Surfer faz
  // as duas coisas, `insert_item` mais `markers.insert`, e e isso que espelhamos.
  //
  // O `idx` do item e a chave do mapa sao o MESMO numero: e por ele que o
  // `numbered_marker_time` liga um ao outro.
  const marcadores = (Array.isArray(input.markers) ? input.markers : [])
    .filter((m) => m && Number.isFinite(m.time))
    .slice(0, MAX_MARKERS);
  for (let i = 0; i < marcadores.length; i++) {
    const ref = nextRef++;
    nodes.push({ ref, level: 0, unfolded: true });
    entries.push(emitMarker(ref, i, marcadores[i].label ?? null));
  }

  const itemsTree = emitItemsTree(nodes);
  const displayed = entries.join('\n');
  const counter = nextRef;

  // Formato nativo do Surfer v0.7.0: `markers: { <idx>: (1, [<tempo>]) }`. O
  // mapa e' HashMap<u8, BigInt>, e o `(1, [...])` e a forma serde do BigInt,
  // sinal mais digitos; o tempo e' o #N cru do dump.
  const markersRon = marcadores.length === 0
    ? '{}'
    : `{\n${marcadores.map((m, i) => `            ${i}: (1, [${Math.trunc(m.time)}]),`).join('\n')}\n        }`;
  const cursorWindow = input.showCursorWindow ? 'true' : 'false';

  // Esqueleto externo = defaults estaveis do UserState (todos os toggles None,
  // frame_buffer/variable_filter nos defaults). So o bloco `waves` e derivado.
  return `(
    show_hierarchy: None,
    show_menu: None,
    show_ticks: None,
    show_toolbar: None,
    show_tooltip: None,
    show_scope_tooltip: None,
    show_default_timeline: None,
    show_overview: None,
    show_statusbar: None,
    align_names_right: None,
    show_variable_indices: None,
    show_variable_direction: None,
    show_empty_scopes: None,
    show_hierarchy_icons: None,
    show_parameters_in_scopes: None,
    parameter_display_location: None,
    highlight_focused: None,
    fill_high_values: None,
    primary_button_drag_behavior: None,
    arrow_key_bindings: None,
    clock_highlight_type: None,
    hierarchy_style: None,
    autoload_sibling_state_files: None,
    // NB: o auto-reload e ligado pelo config.toml (SurferConfig.autoreload_files),
    // NAO por este campo do state, aqui ele e inerte. Ver writeSurferCenteredWindowConfig.
    autoreload_files: None,
    waves: Some((
        source: File(${ronStr(input.vcdPath)}),
        format: ${fmt},
        active_scope: None,
${itemsTree}
        displayed_items: {
${displayed}
        },
        display_item_ref_counter: ${counter},
        viewports: [
            (
                curr_left: (0.0),
                curr_right: (1.0),
                target_left: (0.0),
                target_right: (1.0),
                move_start_left: (0.0),
                move_start_right: (1.0),
                move_duration: None,
                move_strategy: Instant,
            ),
        ],
        cursor: None,
        markers: ${markersRon},
        // Campos do WaveData sem #[serde(default)] no binario que a AURORA
        // embarca (surfer-aurora, base v0.7.0 + commits do upstream): a
        // desserializacao RON e' estrita e um campo obrigatorio ausente derruba
        // o load INTEIRO (o Surfer abre o dump cru, sem a curadoria). O struct
        // EXTERNO UserState tem #[serde(default)] no nivel do struct, entao la
        // omitir campo e' inofensivo; o WaveData interno NAO tem, entao estes
        // tres precisam ser emitidos. Espelham o save nativo (vazio/false/0):
        //   annotation_groups: Vec<AnnotationGroup>, annotation_list_visible:
        //   bool, last_active_viewport_idx: usize.
        annotation_groups: [],
        annotation_list_visible: false,
        last_active_viewport_idx: 0,
        focused_item: None,
        focused_transaction: (None, None),
        default_variable_name_type: Unique,
        scroll_offset: 0.0,
        display_variable_indices: true,
        graphics: {},
    )),
    drag_started: false,
    drag_source_idx: None,
    drag_target_idx: None,
    previous_waves: None,
    count: None,
    blacklisted_translators: [],
    show_about: false,
    show_keys: false,
    show_gestures: false,
    show_quick_start: false,
    show_license: false,
    show_performance: false,
    show_logs: false,
    show_cursor_window: ${cursorWindow},
    frame_buffer: {
        "pixels_per_row": 16,
        "square_pixels": true,
        "color_mode": Grayscale,
        "grayscale_bits": 1,
        "r_bits": 3,
        "g_bits": 3,
        "b_bits": 2,
        "y_bits": 8,
        "cb_bits": 8,
        "cr_bits": 8,
    },
    wanted_timeunit: PicoSeconds,
    time_string_format: None,
    show_url_entry: false,
    variable_name_filter_focused: false,
    variable_filter: (
        name_filter_type: Contain,
        name_filter_str: "",
        name_filter_case_insensitive: true,
        include_inputs: true,
        include_outputs: true,
        include_inouts: true,
        include_others: true,
        group_by_direction: false,
    ),
    sidepanel_width: Some(300.0),
    ui_zoom_factor: None,
    animation_enabled: None,
    use_dinotrace_style: None,
    transition_value: None,
)
`;
}

// ===========================================================================
//  CAMADA DE CURADORIA, buildSurferLayout
//  Espelha buildAuroraGtkw (gtkw_proc_writer.ts): mesma deteccao de
//  processador e mesma ordem de secoes (Top-level -> por-proc: banner ->
//  clk/rst/itr -> I/O -> Instructions -> Variables -> Flags), mas emite
//  SurferItems (declarativos) em vez de linhas @<hexflag> do GTKWave.
//
//  Mapeamento de formato GTKWave -> translator Surfer (item.format):
//    FMT_BIN -> Binary | FMT_DEC -> Unsigned | FMT_SIGNED_DEC -> Signed
//    FMT_REAL -> 'FP: 32-bit IEEE 754' | FMT_ANALOG_* -> underlying + analog
//  Cores: Orange(2)->Orange, Yellow(3)->Yellow, Indigo(6)/Violet(7)->Violet,
//  NORMAL(0)->sem cor.
//
//  v1 NAO traduz valr2/linetabs por mapping translator (Assembly/linha-fonte
//  ficam em decimal cru, igual ao GTKWave sem os trad files) nem decodifica
//  complexos (comp2gtkw), esses dependem do mecanismo de mapping translator
//  do Surfer (.surfer/mappings), uma fase 2 com risco de descoberta no Windows
//  a validar. Tudo o mais (cores, formatos, analog, aliases, secoes, arrays,
//  flags) tem paridade.
// ===========================================================================

export interface BuildSurferLayoutInput {
  /** Path absoluto do VCD/FST (dica de source; a CLI sobrescreve). */
  vcdPath: string;
  /** Scope tree parseado do VCD (parseVcdHeaderFromContent). */
  scopes: VcdScope[];
  /** Scope do testbench top, fallback de clk/rst/itr. */
  tbModule?: string | null;
  /** Filtro: full-paths selecionados no picker. Vazio = layout completo. */
  selectedSignals?: string[] | null;
  /** Modules parseados (parseVerilogModules), procType correto + signedSet. */
  modules?: Map<string, ModuleInfo> | null;
  /**
   * Conteudo cru dos trad files do YANC por procType (lidos do
   * Temp/<procType>/). `opcode` = trad_opcode.txt (track Assembly/valr2),
   * `cmm` = trad_cmm.txt (track C+-/linetabs). null/ausente = sem decode
   * (o track abre em decimal cru). Vira mapping translators do Surfer.
   */
  tradByProcType?: Record<string, { opcode?: string | null; cmm?: string | null }> | null;
  /** Prefixo p/ nomear os mapping files de forma unica (ex.: top do tb). */
  mappingNamespace?: string | null;
  /**
   * Mapping translator dos numeros COMPLEXOS (comp_me3_/comp_arr_me3_), pre-
   * computado pelo renderer (extrai os valores do dump + decodifica via
   * comp2gtkw.exe, ver complex_decode.ts). { name, content } compartilhado por
   * todos os sinais complexos (o decode depende so do bitpattern). null = sem
   * decode (complexos abrem em Binary cru).
   */
  complexMapping?: { name: string; content: string } | null;
  /**
   * Eventos de I/O pra cravar MARCADORES automaticos e medir latencia: a
   * entrada e a saida. Pre-computado pelo renderer via EventScanner
   * (event_markers.ts), que ja devolve `{ time, label }`. Vazio/omit = sem
   * markers, e a janela de Markers nao abre.
   *
   * Aceita numero solto por compatibilidade com quem so tinha o tempo; nesse
   * caso o marcador entra sem rotulo e o Surfer mostra so o indice.
   */
  eventMarkers?: Array<number | { time: number; label?: string | null }> | null;
}

/** Display analogico equivalente ao "Analog Step" do GTKWave. */
const ANALOG_STEP: SurferAnalog = { renderStyle: 'Step', yAxisScale: 'TypeLimits' };

/**
 * Cor de TODOS os labels curados (grupos de secao + banner de processador).
 * Vermelho por contraste: I/O e Yellow, Variables e Orange, Instructions e
 * Violet, vermelho nao colide com nenhuma trilha e bate com os headers
 * vermelhos do GTKWave. O Surfer renderiza o header do grupo em italico; a cor
 * e adicional. Trocar aqui (ex.: 'Yellow') muda todos de uma vez.
 */
const SECTION_COLOR: SurferColor = 'Red';

/**
 * Cria um GRUPO colapsavel de secao (header vermelho). `isOpen` controla o fold
 * inicial: secoes principais abertas, blocos volumosos (arrays/Flags) fechados.
 * Substitui os antigos `divider` de cabecalho, agora cada secao DOBRA.
 */
function mkGroup(name: string, children: SurferItem[], isOpen = true): SurferGroupItem {
  return { kind: 'group', name, color: SECTION_COLOR, isOpen, children };
}

type EnrichedSig = { name: string; range?: string | null; fullName: string };

function slGetScope(scopes: VcdScope[], path: string): VcdScope | null {
  return scopes.find((s) => s.path === path) || null;
}

function slListSignals(scopes: VcdScope[], scopePath: string): EnrichedSig[] {
  const scope = slGetScope(scopes, scopePath);
  if (!scope) return [];
  return scope.signals.map((s) => ({ name: s.name, range: s.range, fullName: `${scope.path}.${s.name}` }));
}

function slFindSignal(scopes: VcdScope[], scopePath: string, name: string): EnrichedSig | null {
  const scope = slGetScope(scopes, scopePath);
  if (!scope) return null;
  const sig = scope.signals.find((x) => x.name === name);
  if (!sig) return null;
  return { name: sig.name, range: sig.range, fullName: `${scope.path}.${sig.name}` };
}

/** Largura em bits de um range "hi:lo" (ou "[hi:lo]"). 0 = escalar/desconhecido. */
function widthFromRange(range?: string | null): number {
  if (!range) return 0;
  const m = /(\d+)\s*:\s*(\d+)/.exec(range);
  if (!m) return 0;
  return Math.abs(parseInt(m[1], 10) - parseInt(m[2], 10)) + 1;
}

/** Nome (== filename == header `Name =` == `format`) de um mapping, FS-safe. */
function mappingName(kind: 'asm' | 'src', namespace: string, procType: string): string {
  return `aurora_${kind}_${namespace}_${procType}`.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Converte um trad file do YANC ("<chave-decimal> <texto>" por linha) num
 * mapping translator do Surfer. Regras validadas no binario v0.7.0:
 *  - header `Name = <nome>` (+ `Bits = <n>` quando a largura e conhecida);
 *  - o Surfer casa a chave pelo VALOR NUMERICO dos bits (radix livre);
 *  - chaves NEGATIVAS (linetabs: -1/-2/-3) viram o padrao de bits UNSIGNED na
 *    largura do sinal (ex.: 20-bit -1 → 0xFFFFF), o Surfer nao casa assinado;
 *  - linhas SEM texto sao PULADAS: o Surfer rejeita ("Missing mapping") e a
 *    falha derruba o arquivo inteiro, o que faz o Surfer DAR PANIC quando o
 *    .surf.ron referencia um translator que nao carregou;
 *  - o texto vai verbatim (espacos e '#' OK, '#' so e comentario no inicio
 *    da linha no Surfer, e aqui a linha sempre comeca pela chave numerica).
 */
export function convertTradToSurferMapping(name: string, bits: number, tradText: string): string {
  const mod = bits > 0 ? Math.pow(2, bits) : 0;
  const out: string[] = [`Name = ${name}`];
  if (bits > 0) out.push(`Bits = ${bits}`);
  for (const raw of String(tradText ?? '').split(/\r?\n/)) {
    if (!raw.length) continue;
    const sp = raw.indexOf(' ');
    const key = sp === -1 ? raw : raw.slice(0, sp);
    const text = (sp === -1 ? '' : raw.slice(sp + 1)).replace(/[ \t\r\n]+$/, '');
    if (text === '') continue;
    let outKey = key;
    if (/^-\d+$/.test(key)) {
      if (mod <= 0) continue; // sem largura nao da pra mapear o negativo
      outKey = '0x' + ((((parseInt(key, 10) % mod) + mod) % mod)).toString(16).toUpperCase();
    }
    out.push(`${outKey} ${text}`);
  }
  return out.join('\n') + '\n';
}

/**
 * Para um processador, resolve o `format` dos tracks Assembly/C+- e acumula os
 * mapping files a escrever. Com trad file presente → format = nome do mapping
 * (decode); sem ele → fallback decimal cru ('Unsigned'/'Signed'). Dedup por nome
 * (varios instances do mesmo procType compartilham o mesmo trad/decode).
 */
function resolveProcMappings(
  scopes: VcdScope[],
  proc: { instancePath: string; procType: string },
  tradByProcType: Record<string, { opcode?: string | null; cmm?: string | null }> | null,
  namespace: string,
  mappings: Array<{ name: string; content: string }>,
): { asmFormat: string; srcFormat: string } {
  let asmFormat = 'Unsigned';
  let srcFormat = 'Signed';
  const trad = tradByProcType ? tradByProcType[proc.procType] : null;
  if (!trad) return { asmFormat, srcFormat };
  const add = (name: string, bits: number, tradText: string): void => {
    if (!mappings.some((m) => m.name === name)) {
      mappings.push({ name, content: convertTradToSurferMapping(name, bits, tradText) });
    }
  };
  if (trad.opcode) {
    const name = mappingName('asm', namespace, proc.procType);
    add(name, widthFromRange(slFindSignal(scopes, proc.instancePath, 'valr2')?.range), trad.opcode);
    asmFormat = name;
  }
  if (trad.cmm) {
    const name = mappingName('src', namespace, proc.procType);
    add(name, widthFromRange(slFindSignal(scopes, proc.instancePath, 'linetabs')?.range), trad.cmm);
    srcFormat = name;
  }
  return { asmFormat, srcFormat };
}

/** Empurra um GRUPO colapsavel da secao (header + filhos), mas SO se ha itens. */
function pushSection(items: SurferItem[], label: string, sectionItems: SurferItem[], isOpen = true): void {
  if (sectionItems.length === 0) return;
  items.push(mkGroup(label, sectionItems, isOpen));
}

function passesFilter(filter: Set<string> | null, fullName: string): boolean {
  return !filter || filter.has(fullName);
}

// ---- secoes ----------------------------------------------------------------

function buildTopLevel(scopes: VcdScope[], procPaths: string[], filter: Set<string> | null, signedSet: Set<string> | null): SurferItem[] {
  const out: SurferItem[] = [];
  const isInside = (p: string): boolean => procPaths.some((pp) => p === pp || p.startsWith(pp + '.'));
  for (const scope of scopes) {
    if (isInside(scope.path)) continue;
    for (const sig of scope.signals) {
      const fullName = `${scope.path}.${sig.name}`;
      if (!passesFilter(filter, fullName)) continue;
      const range = sig.range ?? null;
      // range === null => escalar de 1 bit: 'Bit' desenha onda quadrada (ver pushClk).
      const format = range === null ? 'Bit' : (signedSet && signedSet.has(fullName) ? 'Signed' : 'Unsigned');
      out.push({ kind: 'variable', scope: scope.path.split('.'), name: sig.name, format });
    }
  }
  return out;
}

function pushClk(items: SurferItem[], filter: Set<string> | null, scopes: VcdScope[], corePath: string | null, tbModule: string | null, name: string): void {
  let sig = corePath ? slFindSignal(scopes, corePath, name) : null;
  let scopePath: string | null = corePath;
  if (!sig && tbModule) { sig = slFindSignal(scopes, tbModule, name); scopePath = tbModule; }
  if (!sig || !scopePath) return;
  if (!passesFilter(filter, sig.fullName)) return;
  // clk/rst/itr sao 1-bit e aparecem em todo proc, uma altura levemente
  // reduzida deixa os sinais de dado (variaveis/instrucoes) mais proeminentes.
  // NB: 0.5 era curto demais, o rotulo da linha nao cabia e "encavalava" com a
  // linha vizinha (ilegivel). 0.8 mantem clk/rst um pouco menores, mas legiveis.
  // format 'Bit' (nao 'Binary'): o BitTranslator do Surfer reporta
  // VariableInfo::Bool e desenha o sinal como ONDA QUADRADA (dois niveis).
  // 'Binary' usa o BinaryTranslator (VariableInfo::Bits), que desenha caixa de
  // valor por segmento, o clk virava "numero" 1/0 em vez de onda. 'Bit' e o
  // tradutor que o proprio Surfer ja prefere para 1 bit.
  items.push({ kind: 'variable', scope: scopePath.split('.'), name, format: 'Bit', heightScale: 0.8 });
}

function buildIo(scopes: VcdScope[], instancePath: string, filter: Set<string> | null): SurferItem[] {
  const out: SurferItem[] = [];
  const sigs = slListSignals(scopes, instancePath);
  const by = (re: RegExp): EnrichedSig[] => sigs.filter((s) => re.test(s.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const reqIns = by(/^req_in_sim_?\d+$/);
  const inSims = by(/^in_sim_?\d+$/);
  const outEns = by(/^out_en_sim_?\d+$/);
  const outSigs = by(/^out_sig_?\d+$/);
  const push = (sig: EnrichedSig | undefined, format: string, manualName: string): void => {
    if (!sig || !passesFilter(filter, sig.fullName)) return;
    out.push({ kind: 'variable', scope: instancePath.split('.'), name: sig.name, format, color: 'Yellow', manualName });
  };
  // req_in/out_en sao 1-bit (handshake) -> 'Bit' (onda quadrada); in/out sao
  // barramentos -> 'Signed'.
  const n1 = Math.max(reqIns.length, inSims.length);
  for (let i = 0; i < n1; i++) { push(reqIns[i], 'Bit', `req_in ${i}`); push(inSims[i], 'Signed', `input  ${i}`); }
  const n2 = Math.max(outEns.length, outSigs.length);
  for (let i = 0; i < n2; i++) { push(outEns[i], 'Bit', `out_en ${i}`); push(outSigs[i], 'Signed', `output ${i}`); }
  return out;
}

/**
 * Os tracks de instrucao (Assembly/valr2 + C+-/linetabs) sao a ASSINATURA
 * curada do SAPHO e sao SEMPRE emitidos quando os sinais existem, de proposito
 * NAO passam pelo filtro do picker (o usuario quer que "sempre que ha
 * processadores eles aparecem no Surfer"). Como sao chamados SO de dentro do
 * loop por-processador, quando nao ha processador detectado eles nao aparecem.
 * O label carrega o NOME DO PROCESSADOR (`procName`, ex.: "Assembly (ProcDTW)")
 * pra distinguir as instrucoes de cada proc em designs multi-processador, o
 * divider acima ja traz o instanceName, entao os dois se complementam.
 * asmFormat/srcFormat = nome do mapping translator (decode de mnemonico/linha-
 * fonte) ou o fallback decimal cru.
 */
function buildInstructions(scopes: VcdScope[], instancePath: string, procName: string, asmFormat: string, srcFormat: string): SurferItem[] {
  const out: SurferItem[] = [];
  const push = (sig: EnrichedSig | null, format: string, manualName: string): void => {
    if (!sig) return; // sem passesFilter: tracks curados sempre aparecem
    out.push({ kind: 'variable', scope: instancePath.split('.'), name: sig.name, format, color: 'Violet', manualName });
  };
  push(slFindSignal(scopes, instancePath, 'valr2'), asmFormat, `Assembly (${procName})`);
  push(slFindSignal(scopes, instancePath, 'linetabs'), srcFormat, `C+- (${procName})`);
  return out;
}

function findTypedVars(scopes: VcdScope[], instancePath: string, prefix: string): Array<{ sig: EnrichedSig; varName: string; func: string }> {
  const out: Array<{ sig: EnrichedSig; varName: string; func: string }> = [];
  for (const s of slListSignals(scopes, instancePath)) {
    if (!s.name.startsWith(prefix)) continue;
    const m = s.name.match(/_f_(.*?)_v_(.*?)_e_$/);
    if (!m) continue;
    out.push({ sig: s, varName: m[2], func: m[1] === 'global' ? 'global' : `${m[1]}()` });
  }
  out.sort((a, b) => a.sig.name.localeCompare(b.sig.name));
  return out;
}

function pushArrays(out: SurferItem[], scopes: VcdScope[], instancePath: string, prefix: string, format: string, typeLabel: string, tag: string, filter: Set<string> | null): void {
  const groups = new Map<string, Array<{ sig: EnrichedSig; idx: number }>>();
  for (const s of slListSignals(scopes, instancePath)) {
    if (!s.name.startsWith(prefix)) continue;
    const m = s.name.match(/^(.*?)(\d{4})$/);
    if (!m) continue;
    const base = m[1];
    const bucket = groups.get(base);
    if (bucket) bucket.push({ sig: s, idx: parseInt(m[2], 10) });
    else groups.set(base, [{ sig: s, idx: parseInt(m[2], 10) }]);
  }
  for (const baseName of [...groups.keys()].sort()) {
    const elems = (groups.get(baseName) ?? []).sort((a, b) => a.idx - b.idx);
    const m = baseName.match(/_f_(.*?)_v_(.*?)_e_/);
    const vr = m ? m[2] : baseName;
    const funcLabel = m ? (m[1] === 'global' ? 'global' : `${m[1]}()`) : '';
    const groupLabel = `${typeLabel} ${vr} in ${funcLabel}${tag}`;
    const elemItems: SurferItem[] = [];
    let i = 0;
    for (const { sig } of elems) {
      if (passesFilter(filter, sig.fullName)) {
        elemItems.push({ kind: 'variable', scope: instancePath.split('.'), name: sig.name, format, color: 'Orange', manualName: `${vr} ${i}` });
      }
      i++;
    }
    if (elemItems.length > 0) {
      // Array vira um grupo FECHADO por padrao (volumoso, N elementos).
      out.push(mkGroup(groupLabel, elemItems, false));
    }
  }
}

function buildVariables(scopes: VcdScope[], instancePath: string, procName: string | null, filter: Set<string> | null, complexFormat: string | null): SurferItem[] {
  const out: SurferItem[] = [];
  const cpx = complexFormat || 'Binary'; // mapping de decode complexo, ou Binary cru
  // Em designs MULTI-processador a MESMA variavel ("float acc in global") repete
  // entre procs sem rotulo que diga de qual proc e, so o grupo dobravel ajudava.
  // A tag (procType) desambigua, espelhando a das instrucoes (buildInstructions).
  // Em single-proc procName e null e o sufixo some (sem ruido onde nao ha duvida).
  const tag = procName ? ` (${procName})` : '';
  const pushTyped = (list: Array<{ sig: EnrichedSig; varName: string; func: string }>, format: string, label: string): void => {
    for (const v of list) {
      if (!passesFilter(filter, v.sig.fullName)) continue;
      out.push({ kind: 'variable', scope: instancePath.split('.'), name: v.sig.name, format, color: 'Orange', manualName: `${label} ${v.varName} in ${v.func}${tag}` });
    }
  };
  // Floats (me2_/arr_me2_) ficam como NUMERO (FP), nao como onda analog: uma
  // constante float viraria uma reta inutil e o usuario perde o valor legivel.
  pushTyped(findTypedVars(scopes, instancePath, 'me1_'), 'Signed', 'int');
  pushTyped(findTypedVars(scopes, instancePath, 'me2_'), 'FP: 32-bit IEEE 754', 'float');
  pushTyped(findTypedVars(scopes, instancePath, 'comp_me3_'), cpx, 'comp');
  pushArrays(out, scopes, instancePath, 'arr_me1_', 'Signed', 'int', tag, filter);
  pushArrays(out, scopes, instancePath, 'arr_me2_', 'FP: 32-bit IEEE 754', 'float', tag, filter);
  pushArrays(out, scopes, instancePath, 'comp_arr_me3_', cpx, 'comp', tag, filter);
  return out;
}

function buildFlags(scopes: VcdScope[], corePath: string | null, filter: Set<string> | null): SurferItem[] {
  if (!corePath) return [];
  // Monitor de stack/ULA: caminho interno real primeiro, senao o espelho
// aurora_* no escopo raiz (ver deriveMonitorScopes). Devolve o scope como
// array (forma que o .surf.ron usa) + o nome resolvido.
function slFindMonitor(scopes: VcdScope[], corePath: string, inst: string, name: string): { sig: EnrichedSig, scope: string[], name: string } | null {
  const direct = slFindSignal(scopes, corePath + '.' + inst, name);
  if (direct) return { sig: direct, scope: (corePath + '.' + inst).split('.'), name };
  const root = corePath.split('.')[0];
  const rel = corePath.startsWith(root + '.') ? corePath.slice(root.length + 1) : corePath;
  const mirror = monitorMirrorName(rel, inst, name);
  const viaMirror = slFindSignal(scopes, root, mirror);
  if (viaMirror) return { sig: viaMirror, scope: [root], name: mirror };
  return null;
}

const stackSpec = [
    { path: `${corePath}.sp`,  name: 'pointeri', format: 'Signed',   analog: true,  alias: 'Data Stack Pointer' },
    { path: `${corePath}.sp`,  name: 'fl_max',   format: 'Unsigned', analog: false, alias: 'Data Stack Max' },
    { path: `${corePath}.sp`,  name: 'fl_full',  format: 'Bit',      analog: false, alias: 'Data Stack Overflow' },
    { path: `${corePath}.isp`, name: 'pointeri', format: 'Signed',   analog: true,  alias: 'Inst Stack Pointer' },
    { path: `${corePath}.isp`, name: 'fl_max',   format: 'Unsigned', analog: false, alias: 'Inst Stack Max' },
    { path: `${corePath}.isp`, name: 'fl_full',  format: 'Bit',      analog: false, alias: 'Inst Stack Overflow' },
  ];
  const stackItems: SurferItem[] = [];
  for (const e of stackSpec) {
    const inst = e.path.endsWith('.isp') ? 'isp' : 'sp';
    const res = slFindMonitor(scopes, corePath, inst, e.name);
    if (!res || !passesFilter(filter, res.sig.fullName)) continue;
    stackItems.push({ kind: 'variable', scope: res.scope, name: res.name, format: e.format, manualName: e.alias, analog: e.analog ? ANALOG_STEP : null });
  }
  const ulaItems: SurferItem[] = [];
  const pushUla = (name: string, alias: string): void => {
    const res = slFindMonitor(scopes, corePath, 'ula', name);
    if (!res || !passesFilter(filter, res.sig.fullName)) return;
    ulaItems.push({ kind: 'variable', scope: res.scope, name: res.name, format: 'Hexadecimal', manualName: alias, analog: ANALOG_STEP });
  };
  pushUla('delta_int', 'Rounding Error (int)');
  pushUla('delta_float', 'Rounding Error (float)');
  if (stackItems.length === 0 && ulaItems.length === 0) return [];
  const out: SurferItem[] = [];
  if (stackItems.length > 0) out.push(mkGroup('Stack', stackItems, true));
  if (ulaItems.length > 0) out.push(mkGroup('ULA', ulaItems, true));
  return out;
}

/**
 * Constroi o conteudo de um .surf.ron curado a partir do VCD parseado +
 * curadoria SAPHO (reusa detectProcessors/resolveScopeModules/buildSignedSet
 * verbatim do gtkw_proc_writer). Mesma ordem/selecao de sinais que o .gtkw.
 *
 * @returns { content, processorCount }, content=null so quando scopes vazio.
 */
export function buildSurferLayout(input: BuildSurferLayoutInput): { content: string | null; processorCount: number; mappings: Array<{ name: string; content: string }> } {
  const { vcdPath, scopes, tbModule = null, selectedSignals = null, modules = null, tradByProcType = null, mappingNamespace = '', complexMapping = null, eventMarkers = null } = input;
  if (!Array.isArray(scopes) || scopes.length === 0) return { content: null, processorCount: 0, mappings: [] };

  const filter = (Array.isArray(selectedSignals) && selectedSignals.length > 0) ? new Set(selectedSignals) : null;
  const scopeModules = modules ? resolveScopeModules(scopes, modules) : null;
  const procs = detectProcessors(scopes, scopeModules);
  const signedSet = modules ? buildSignedSet(scopes, modules, scopeModules) : null;
  const ns = String(mappingNamespace || '');
  const cpxFormat = complexMapping ? complexMapping.name : null;
  const mappings: Array<{ name: string; content: string }> = [];

  const items: SurferItem[] = [];
  pushSection(items, 'Top-level', buildTopLevel(scopes, procs.map((p) => p.instancePath), filter, signedSet));
  for (const proc of procs) {
    // Cada processador vira um GRUPO COLAPSAVEL (header = instanceName, vermelho)
    // contendo toda a sua secao, em designs multi-proc o usuario pode dobrar os
    // processadores que nao interessam. is_open: true = expandido por padrao.
    const procItems: SurferItem[] = [];
    pushClk(procItems, filter, scopes, proc.corePath, tbModule, 'clk');
    pushClk(procItems, filter, scopes, proc.corePath, tbModule, 'rst');
    pushClk(procItems, filter, scopes, proc.corePath, tbModule, 'itr');
    pushSection(procItems, 'I/O', buildIo(scopes, proc.instancePath, filter));
    const { asmFormat, srcFormat } = resolveProcMappings(scopes, proc, tradByProcType, ns, mappings);
    pushSection(procItems, 'Instructions', buildInstructions(scopes, proc.instancePath, proc.procType, asmFormat, srcFormat));
    pushSection(procItems, 'Variables', buildVariables(scopes, proc.instancePath, procs.length > 1 ? proc.procType : null, filter, cpxFormat));
    pushSection(procItems, 'Flags', buildFlags(scopes, proc.corePath, filter), false); // Flags fecha por padrao (debug secundario)
    items.push(mkGroup(proc.instanceName, procItems, true));
  }
  if (complexMapping) mappings.push(complexMapping); // 1 mapping compartilhado por todos os complexos

  const marcadores: SurferMarker[] = (Array.isArray(eventMarkers) ? eventMarkers : [])
    .map((m) => (typeof m === 'number'
      ? { time: m, label: null }
      : { time: m?.time, label: rotuloDeEvento(m?.label) }))
    .filter((m) => Number.isFinite(m.time));

  return {
    content: buildSurferState({
      vcdPath, sourceFormat: 'Vcd', items,
      markers: marcadores,
      // A janela so abre quando ha DOIS ou mais marcadores, porque o que ela
      // serve e a diferenca entre eles. Com um so, o numero ja aparece na caixa
      // desenhada sobre a onda, e abrir um painel flutuante por cima do trace
      // para repetir esse mesmo numero e' so estorvo. Antes ela abria sempre que
      // havia qualquer marcador, e como o item visivel nunca era emitido, abria
      // vazia toda simulacao.
      showCursorWindow: marcadores.length >= 2,
    }),
    processorCount: procs.length,
    mappings,
  };
}

/**
 * Rotulo que aparece na coluna da janela de Markers. O EventScanner classifica
 * o evento como 'input' ou 'output'; o resto passa verbatim, e a ausencia vira
 * null para o Surfer cair no indice.
 */
function rotuloDeEvento(label: string | null | undefined): string | null {
  if (label === 'input') return 'Input';
  if (label === 'output') return 'Output';
  return label ? String(label) : null;
}
