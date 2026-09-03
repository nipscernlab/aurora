/**
 * verilog_stats.js: quantos modulos, portas e instancias uma compilacao
 * produziu, para o terminal dizer em uma linha o que saiu dela.
 *
 * Duas fontes, porque sao dois momentos:
 *
 *   - `analisarVerilog(texto)` le um .v de verdade, o `<proc>.v` que o asmcomp
 *     acabou de gerar. E leitura de texto, tolerante: comentarios e blocos
 *     `#( ... )` de parametros saem antes, e a mesma instancia repetida sob
 *     `ifdef`/`else` conta uma vez.
 *   - `resumirHierarquiaYosys(json, top)` le o `write_json` que o Yosys emitiu
 *     depois de elaborar o projeto inteiro (fluxo Verilog). Ai o numero vem
 *     da elaboracao, e nao de texto: modulos do usuario alcancados a partir do
 *     top, portas do top e celulas por familia.
 *
 * Puro e sem DOM, para ter teste. Quem escreve no terminal e quem chama.
 */

const PALAVRAS = new Set([
  'module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'assign',
  'always', 'initial', 'if', 'else', 'for', 'while', 'case', 'casex', 'casez',
  'endcase', 'begin', 'end', 'function', 'endfunction', 'task', 'endtask',
  'parameter', 'localparam', 'integer', 'real', 'generate', 'endgenerate',
  'genvar', 'signed', 'unsigned', 'posedge', 'negedge', 'default', 'return',
  'logic', 'bit', 'byte', 'int', 'shortint', 'longint', 'time', 'realtime',
  'defparam', 'specify', 'endspecify', 'primitive', 'endprimitive', 'table',
  'endtable', 'fork', 'join', 'wait', 'disable', 'force', 'release', 'deassign',
  'supply0', 'supply1', 'tri', 'tri0', 'tri1', 'wand', 'wor', 'trireg', 'event',
  'not', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'buf',
]);

/**
 * Tira comentarios de linha e de bloco e as diretivas do pre-processador
 * (`ifdef`, `else`, `endif`, `define`, `timescale`...), preservando o resto.
 * As diretivas saem porque o `<proc>.v` gerado instancia o processador duas
 * vezes, uma em cada ramo de um `ifdef`, e a palavra depois do `ifdef` era
 * lida como se fosse o tipo da instancia.
 */
function semComentarios(texto) {
  return String(texto || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^[ \t]*`[^\n]*/gm, ' ');
}

/** Tira os blocos `#( ... )` balanceados, que sao parametros e nao portas. */
function semParametros(texto) {
  let out = '';
  let i = 0;
  while (i < texto.length) {
    const hash = texto.indexOf('#', i);
    if (hash < 0) { out += texto.slice(i); break; }
    const abre = texto.indexOf('(', hash);
    if (abre < 0 || texto.slice(hash + 1, abre).trim() !== '') {
      out += texto.slice(i, hash + 1);
      i = hash + 1;
      continue;
    }
    let prof = 0;
    let j = abre;
    for (; j < texto.length; j++) {
      if (texto[j] === '(') prof++;
      else if (texto[j] === ')') { prof--; if (prof === 0) break; }
    }
    out += texto.slice(i, hash) + ' ';
    i = j + 1;
  }
  return out;
}

/**
 * As portas declaradas num corpo de modulo (cabecalho ANSI ou declaracoes no
 * corpo): cada `input|output|inout` seguido de tipo/faixa opcionais e de uma
 * lista de nomes ate `,` do proximo direcional, `)` ou `;`.
 */
function portasDe(corpo) {
  const vistas = new Map();
  const re = /\b(input|output|inout)\b([^;)]*?)(?=\b(?:input|output|inout)\b|[;)])/g;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    const dir = m[1];
    const resto = m[2]
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\b(wire|reg|logic|signed|unsigned|integer|real|bit|byte|var)\b/g, ' ')
      .replace(/=[^,]*/g, ' ');
    for (const nome of resto.split(',')) {
      const n = nome.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(n)) continue;
      if (!vistas.has(n)) vistas.set(n, dir);
    }
  }
  return [...vistas.entries()].map(([name, dir]) => ({ name, dir }));
}

/** As instancias de um corpo: `Tipo nome (` fora das palavras da linguagem. */
function instanciasDe(corpo) {
  const vistas = new Map();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(corpo)) !== null) {
    const tipo = m[1];
    const nome = m[2];
    if (PALAVRAS.has(tipo) || PALAVRAS.has(nome)) continue;
    if (!vistas.has(nome)) vistas.set(nome, tipo);
  }
  return [...vistas.entries()].map(([name, module]) => ({ name, module }));
}

/**
 * Le um arquivo Verilog e devolve os modulos, com portas e instancias.
 * @param {string} texto
 * @returns {{ modules: Array<{ name: string, ports: Array<{name: string, dir: string}>, instances: Array<{name: string, module: string}> }> }}
 */
export function analisarVerilog(texto) {
  const limpo = semParametros(semComentarios(texto));
  const modules = [];
  const re = /\bmodule\s+([A-Za-z_][A-Za-z0-9_]*)([\s\S]*?)\bendmodule\b/g;
  let m;
  while ((m = re.exec(limpo)) !== null) {
    const nome = m[1];
    const corpo = m[2];
    modules.push({ name: nome, ports: portasDe(corpo), instances: instanciasDe(corpo) });
  }
  return { modules };
}

/**
 * Totais de uma analise, prontos para uma linha de terminal.
 * @param {{ modules: Array<{ ports: Array<{dir: string}>, instances: any[] }> }} analise
 */
export function totaisDoVerilog(analise) {
  const t = { modules: 0, ports: 0, inputs: 0, outputs: 0, inouts: 0, instances: 0 };
  for (const mod of analise?.modules || []) {
    t.modules += 1;
    t.instances += mod.instances.length;
    for (const p of mod.ports) {
      t.ports += 1;
      if (p.dir === 'input') t.inputs += 1;
      else if (p.dir === 'output') t.outputs += 1;
      else t.inouts += 1;
    }
  }
  return t;
}

// ── Yosys ───────────────────────────────────────────────────────────────────

/** Tipos de celula que o Yosys cria ao elaborar, nao modulos do usuario. */
const PRIMITIVA = /^\$/;

/** A familia legivel de uma celula primitiva do Yosys. */
function familiaDe(tipo) {
  const base = String(tipo).replace(/^\$+/, '').replace(/^_/, '').replace(/_$/, '').replace(/_v\d+$/, '').toLowerCase();
  if (/^(dff|dffe|adff|adffe|sdff|sdffe|dlatch|dlatchsr|dffsr|aldff)/.test(base)) return 'registers';
  if (/^(mem|memrd|memwr|meminit)/.test(base)) return 'memories';
  if (/^(mux|pmux|bmux|demux)/.test(base)) return 'muxes';
  if (/^(add|sub|mul|div|mod|pow|neg|alu|macc|lcu|fa)/.test(base)) return 'arithmetic';
  if (/^(eq|ne|lt|le|gt|ge|eqx|nex)/.test(base)) return 'comparators';
  if (/^(shl|shr|sshl|sshr|shift|shiftx)/.test(base)) return 'shifts';
  return 'logic';
}

/**
 * Resume o `write_json` do Yosys: modulos do usuario alcancados a partir do
 * top, portas do top e celulas por familia no projeto inteiro.
 *
 * O nome no JSON e mutilado pelo Yosys (`$paramod\core\NUBITS=32`); o modulo
 * do usuario e reconhecido por nao comecar com `$`, ou por ser um `$paramod`
 * de um modulo do usuario (o nome vem depois da primeira barra invertida).
 *
 * @param {{ modules?: Record<string, any> }} json
 * @param {string} top nome limpo do top level
 */
export function resumirHierarquiaYosys(json, top) {
  const modules = (json && json.modules) || {};
  const limpo = (nome) => {
    let n = String(nome);
    if (n.startsWith('$paramod')) {
      const partes = n.split('\\');
      n = partes.length >= 2 ? partes[1] : n;
    }
    return n.replace(/^\\/, '');
  };

  const chaveDoTop = Object.keys(modules).find((k) => limpo(k) === top) || null;
  const usuario = new Set();
  const familias = {};
  let instancias = 0;

  const visitar = (chave) => {
    const mod = modules[chave];
    if (!mod) return;
    const nome = limpo(chave);
    if (usuario.has(nome)) return;
    usuario.add(nome);
    for (const cell of Object.values(mod.cells || {})) {
      const tipo = String(cell.type || '');
      if (PRIMITIVA.test(tipo) && !tipo.startsWith('$paramod')) {
        const f = familiaDe(tipo);
        familias[f] = (familias[f] || 0) + 1;
      } else {
        instancias += 1;
        visitar(tipo);
      }
    }
  };
  if (chaveDoTop) visitar(chaveDoTop);

  const portasDoTop = { inputs: 0, outputs: 0, inouts: 0, total: 0 };
  const topMod = chaveDoTop ? modules[chaveDoTop] : null;
  for (const p of Object.values(topMod?.ports || {})) {
    portasDoTop.total += 1;
    if (p.direction === 'input') portasDoTop.inputs += 1;
    else if (p.direction === 'output') portasDoTop.outputs += 1;
    else portasDoTop.inouts += 1;
  }

  const celulas = Object.values(familias).reduce((s, n) => s + n, 0);
  return {
    top,
    encontrouTop: !!chaveDoTop,
    modules: usuario.size,
    moduleNames: [...usuario],
    instances: instancias,
    topPorts: portasDoTop,
    cells: celulas,
    families: familias,
  };
}
