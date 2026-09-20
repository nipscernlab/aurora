// @ts-check
/**
 * history.js: o historico local de cada arquivo do projeto.
 *
 * O QUE ISTO RESOLVE. Aluno perde trabalho. Salva por cima do que funcionava,
 * deixa a IA reescrever um arquivo e se arrepende, apaga o que nao devia. O
 * git ajuda quem faz commit, e quem esta aprendendo raramente faz na hora
 * certa. O VS Code guarda cada gravacao de cada arquivo e deixa voltar; e o
 * que se faz aqui.
 *
 * ONDE MORA. `<projeto>/.aurora/historico/<chave>/`, uma pasta por arquivo,
 * com `indice.json` (o caminho do arquivo e a lista de versoes) e um `.txt`
 * por versao. Dentro do projeto, e nao no perfil do usuario, pela mesma razao
 * do registro de execucoes (run_log.js): copiar o projeto leva o historico
 * junto, apagar o projeto apaga o historico junto. A `.aurora` ja e oculta e o
 * `historico/` entra no `.gitignore` dela (project_temp.js): e da maquina, nao
 * do repositorio.
 *
 * A CHAVE E UM HASH do caminho relativo, e nao o caminho: o caminho tem barras,
 * pode ter espaco e acento, e no Windows `Top.v` e `top.v` sao o mesmo arquivo.
 * O caminho legivel fica dentro do indice, que e quem o mostra.
 *
 * QUEM GRAVA. O funil `write-file` de main/ipc/files.js, por onde passam TODAS
 * as gravacoes: o salvar do editor, o `create_file` da Aurora Intelligence, a
 * substituicao em arquivos. Um funil so, entao nenhum caminho de escrita fica
 * de fora sem que alguem o tenha tirado de proposito. Alem dele, o apagar
 * (`delete-file` e `file:trash`) grava a ultima versao ANTES de apagar, senao
 * a unica copia iria junto.
 *
 * A PRIMEIRA GRAVACAO GUARDA O ANTES. Se um arquivo nunca teve historico e vai
 * ser sobrescrito, o conteudo que estava no disco e guardado primeiro, como
 * versao inicial. Sem isso, a primeira edicao depois de ligar o historico
 * perderia justamente o estado de que se quer voltar.
 *
 * O QUE NAO ENTRA. Arquivo fora do projeto, arquivo dentro da propria
 * `.aurora` (guardar o historico do historico e recursao sem fim), binario
 * (byte NUL nos primeiros 4 KB) e arquivo acima de 1,5 MB, que nao e codigo.
 * Conteudo identico a ultima versao tambem nao entra: salvar sem mudar nada e
 * o gesto mais comum que existe, e cada um viraria uma copia igual.
 *
 * LIMITES. 50 versoes por arquivo, e 20 MB por arquivo. Passou, sai a mais
 * antiga. O valor do historico esta nas ultimas horas e dias de trabalho, e
 * cinquenta gravacoes cobrem isso com folga.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('electron-log');

const { ocultarPastaDeSistemaEm } = require('../pastas_ocultas');

const PASTA = path.join('.aurora', 'historico');
const LIMITE_VERSOES = 50;
const LIMITE_BYTES_POR_ARQUIVO = 20 * 1024 * 1024;
const MAX_ARQUIVO_BYTES = 1.5 * 1024 * 1024;
const BYTES_SONDA_BINARIO = 4096;

/** O `indice.json` de um arquivo, como fica no disco. */
const INDICE_VAZIO = () => ({ formato: 1, arquivo: '', versoes: [] });

// ── caminhos ─────────────────────────────────────────────────────────────────────

/**
 * A pasta de historico do projeto, ou null quando o projeto nao serve.
 * @param {unknown} projeto
 */
function pastaDoProjeto(projeto) {
  if (!projeto || typeof projeto !== 'string' || !path.isAbsolute(projeto)) return null;
  return path.join(path.resolve(projeto), PASTA);
}

/**
 * O caminho do arquivo relativo ao projeto, com barras normais, ou null quando
 * o arquivo esta fora do projeto ou dentro da `.aurora`.
 *
 * Fora do projeto nao ha onde guardar (o historico e do projeto); dentro da
 * `.aurora` seria guardar o historico do proprio historico.
 *
 * @param {string} projeto
 * @param {string} arquivo
 */
function relativoAoProjeto(projeto, arquivo) {
  if (!projeto || !arquivo || !path.isAbsolute(arquivo)) return null;
  const rel = path.relative(path.resolve(projeto), path.resolve(arquivo));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const partes = rel.split(path.sep);
  if (partes.some((p) => p.toLowerCase() === '.aurora')) return null;
  return partes.join('/');
}

/**
 * A chave (nome da pasta) de um arquivo do projeto.
 *
 * Hash do caminho relativo em minusculas: no Windows `Top.v` e `top.v` sao o
 * mesmo arquivo, e duas pastas para um arquivo so quebrariam a linha do
 * historico ao primeiro renomear de caixa.
 *
 * @param {string} relativo caminho relativo com barras normais
 */
function chaveDe(relativo) {
  return crypto.createHash('sha1').update(String(relativo).toLowerCase(), 'utf8').digest('hex').slice(0, 20);
}

/**
 * @param {string} projeto
 * @param {string} relativo
 */
function pastaDoArquivo(projeto, relativo) {
  const base = pastaDoProjeto(projeto);
  return base ? path.join(base, chaveDe(relativo)) : null;
}

/**
 * `2026-09-13T10-42-07-318`: ordena por nome e e seguro como nome de arquivo.
 * @param {number} agora
 */
function idDe(agora) {
  return new Date(agora).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

const ID_VALIDO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}(-[0-9]+)?$/;

// ── o que nao entra ────────────────────────────────────────────────────────────────

/** Binario pela sonda de NUL, o mesmo criterio da busca em arquivos. */
function pareceBinario(/** @type {string|Buffer} */ conteudo) {
  const b = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8');
  const fim = Math.min(b.length, BYTES_SONDA_BINARIO);
  for (let i = 0; i < fim; i += 1) if (b[i] === 0) return true;
  return false;
}

/**
 * Decide se um conteudo pode virar versao.
 * @param {string|Buffer} conteudo
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
function conteudoGuardavel(conteudo) {
  const bytes = Buffer.isBuffer(conteudo) ? conteudo.length : Buffer.byteLength(String(conteudo), 'utf8');
  if (bytes > MAX_ARQUIVO_BYTES) return { ok: false, motivo: 'grande' };
  if (pareceBinario(conteudo)) return { ok: false, motivo: 'binario' };
  return { ok: true };
}

/**
 * Quais versoes sair para caber nos limites: as mais antigas primeiro.
 * Puro, para o teste: recebe a lista (mais antiga primeiro) e devolve os ids.
 *
 * @param {Array<{id:string, bytes:number}>} versoes da mais antiga para a mais nova
 * @param {{ limiteVersoes?: number, limiteBytes?: number }} [limites]
 */
function podarVersoes(versoes, { limiteVersoes = LIMITE_VERSOES, limiteBytes = LIMITE_BYTES_POR_ARQUIVO } = {}) {
  const sair = [];
  let restantes = versoes.slice();
  let bytes = restantes.reduce((s, v) => s + (v.bytes || 0), 0);
  while (restantes.length > limiteVersoes || (bytes > limiteBytes && restantes.length > 1)) {
    const velha = restantes.shift();
    if (!velha) break;
    bytes -= velha.bytes || 0;
    sair.push(velha.id);
  }
  return sair;
}

// ── indice ───────────────────────────────────────────────────────────────────────

/** @param {string} pasta */
function lerIndice(pasta) {
  try {
    const bruto = fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8');
    const d = JSON.parse(bruto);
    if (!d || !Array.isArray(d.versoes)) return INDICE_VAZIO();
    return d;
  } catch {
    return INDICE_VAZIO();
  }
}

/**
 * @param {string} pasta
 * @param {unknown} indice
 */
function gravarIndice(pasta, indice) {
  const alvo = path.join(pasta, 'indice.json');
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(indice, null, 2), 'utf8');
  fs.renameSync(tmp, alvo);
}

function sha1De(/** @type {string} */ texto) {
  return crypto.createHash('sha1').update(texto, 'utf8').digest('hex');
}

// ── gravar, listar, ler ───────────────────────────────────────────────────────────────

/**
 * Guarda uma versao de um arquivo. Sincrona e de melhor esforco: quem chama
 * ja gravou (ou vai apagar) o arquivo de verdade, e falhar aqui nao pode
 * virar erro para a pessoa.
 *
 * @param {string} projeto raiz do projeto
 * @param {string} arquivo caminho absoluto do arquivo
 * @param {string|Buffer} conteudo
 * @param {{ origem?: string, rotulo?: string|null, agora?: number }} [meta]
 * @returns {{ ok: boolean, id?: string, motivo?: string }}
 */
function gravarVersao(projeto, arquivo, conteudo, { origem = 'salvar', rotulo = null, agora = Date.now() } = {}) {
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, motivo: 'fora' };
  const cabe = conteudoGuardavel(conteudo);
  if (!cabe.ok) return { ok: false, motivo: cabe.motivo };

  const texto = Buffer.isBuffer(conteudo) ? conteudo.toString('utf8') : String(conteudo);
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta) return { ok: false, motivo: 'projeto' };

  fs.mkdirSync(pasta, { recursive: true });
  // A `.aurora` pode nascer aqui, antes de qualquer abertura marca-la.
  ocultarPastaDeSistemaEm(pasta);

  const indice = lerIndice(pasta);
  indice.arquivo = relativo;
  const hash = sha1De(texto);
  const ultima = indice.versoes[indice.versoes.length - 1];
  // Salvar sem mudar nada e o gesto mais comum que existe. Cada um viraria uma
  // copia igual a anterior, e a lista ficaria cheia de versoes que nao sao.
  if (ultima && ultima.hash === hash) return { ok: true, id: ultima.id, motivo: 'igual' };

  let id = idDe(agora);
  // Duas gravacoes no mesmo milissegundo (o "antes" e o "depois" da primeira
  // gravacao, por exemplo): a segunda ganha um sufixo em vez de sobrescrever.
  let n = 1;
  while (indice.versoes.some((/** @type {{ id: string }} */ v) => v.id === id)) { id = `${idDe(agora)}-${n}`; n += 1; }

  const alvo = path.join(pasta, `${id}.txt`);
  const tmp = `${alvo}.tmp`;
  fs.writeFileSync(tmp, texto, 'utf8');
  fs.renameSync(tmp, alvo);

  indice.versoes.push({
    id,
    quando: agora,
    bytes: Buffer.byteLength(texto, 'utf8'),
    linhas: texto.split('\n').length,
    hash,
    origem,
    rotulo: rotulo || null,
  });

  for (const velha of podarVersoes(indice.versoes)) {
    indice.versoes = indice.versoes.filter((/** @type {{ id: string }} */ v) => v.id !== velha);
    try { fs.unlinkSync(path.join(pasta, `${velha}.txt`)); } catch { /* ja nao estava */ }
  }
  gravarIndice(pasta, indice);
  return { ok: true, id };
}

/**
 * O "antes" da primeira gravacao. Se o arquivo ainda nao tem historico e ja
 * existe no disco, o conteudo atual do disco vira a versao inicial, para que
 * o estado anterior a primeira edicao tambem tenha para onde voltar.
 *
 * @param {string} projeto
 * @param {string} arquivo
 * @param {number} [agora]
 */
function guardarAntesSePrimeira(projeto, arquivo, agora = Date.now()) {
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, motivo: 'fora' };
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta) return { ok: false, motivo: 'projeto' };
  if (fs.existsSync(path.join(pasta, 'indice.json'))) return { ok: true, motivo: 'ja-tem' };
  let antes;
  try { antes = fs.readFileSync(arquivo); } catch { return { ok: true, motivo: 'novo' }; }
  // Um milissegundo antes, para a versao inicial ordenar antes da gravacao
  // que a motivou mesmo quando as duas cabem no mesmo instante.
  return gravarVersao(projeto, arquivo, antes, { origem: 'inicial', agora: agora - 1 });
}

/**
 * As versoes de um arquivo, da mais nova para a mais antiga, sem o conteudo.
 * @param {string} projeto
 * @param {string} arquivo
 */
function listar(projeto, arquivo) {
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, erro: 'fora do projeto', versoes: [] };
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta || !fs.existsSync(pasta)) return { ok: true, arquivo: relativo, versoes: [] };
  const indice = lerIndice(pasta);
  const versoes = indice.versoes
    .slice()
    .reverse()
    .map((/** @type {{ id: string, quando: number, bytes: number, linhas: number, origem: string, rotulo?: string|null }} */ v) => ({ id: v.id, quando: v.quando, bytes: v.bytes, linhas: v.linhas, origem: v.origem, rotulo: v.rotulo || null }));
  return { ok: true, arquivo: relativo, versoes };
}

/**
 * O conteudo de uma versao.
 * @param {string} projeto
 * @param {string} arquivo
 * @param {string} id
 */
function ler(projeto, arquivo, id) {
  if (!ID_VALIDO.test(String(id || ''))) return { ok: false, erro: 'id invalido' };
  const relativo = relativoAoProjeto(projeto, arquivo);
  if (!relativo) return { ok: false, erro: 'fora do projeto' };
  const pasta = pastaDoArquivo(projeto, relativo);
  if (!pasta) return { ok: false, erro: 'projeto invalido' };
  try {
    return { ok: true, id, conteudo: fs.readFileSync(path.join(pasta, `${id}.txt`), 'utf8') };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ── pontos de restauracao ────────────────────────────────────────────────────────

/*
 * Um ponto de restauracao e um INSTANTE, e nao uma copia do projeto.
 *
 * Cada mensagem que a pessoa manda para a Aurora Intelligence abre um ponto
 * antes de a IA encostar em qualquer arquivo. Guardar o projeto inteiro por
 * mensagem seria caro e redundante: o historico por arquivo ja guarda cada
 * versao, entao o ponto precisa registrar apenas QUANDO foi, e voltar a ele e
 * devolver cada arquivo a versao mais recente daquele instante ou antes.
 *
 * Mas ha um buraco nisso, e e ele que obriga o ponto a fazer uma coisa a mais:
 * um arquivo que nunca foi salvo pela AURORA nao tem versao nenhuma, e a
 * captura preguicosa do `write-file` so o guardaria no momento em que a IA
 * fosse sobrescreve-lo, ja com carimbo POSTERIOR ao ponto. Voltar ao ponto nao
 * acharia nada para esse arquivo justamente quando ele e o que se quer de
 * volta. Por isso abrir um ponto varre as fontes do projeto e garante uma
 * versao para cada uma. Pela deduplicacao de conteudo, isso escreve de verdade
 * so na primeira vez: da segunda mensagem em diante quase nada vai para o
 * disco.
 *
 * ARQUIVO CRIADO DEPOIS vai para a LIXEIRA, e nao para o unlink. Voltar
 * significa desfazer o que a IA fez, e ela pode ter criado arquivos; apagar de
 * vez o que a pessoa talvez quisesse guardar seria trocar um arrependimento
 * por outro. A mesma escolha do apagar projeto.
 */

const PASTA_PONTOS = 'pontos';
const ARQUIVO_VISTA = 'vista.json';

/**
 * A VISTA: o tamanho e a data de cada fonte na ultima vez que foi olhada.
 *
 * Medido antes dela existir: com 300 arquivos o SEGUNDO ponto custava 224 ms,
 * e com 1200, 1,3 s, tudo no processo principal, a cada compilacao e a cada
 * mensagem para a IA. A deduplicacao de conteudo evitava a gravacao, mas nao a
 * leitura nem o hash de cada arquivo. Um projeto grande faria a AURORA travar
 * um segundo por clique de compilar, e ninguem ligaria isso ao historico.
 *
 * Com a vista, um arquivo cujo tamanho e data nao mudaram nem e lido: um
 * `stat` por arquivo, que e dez vezes mais barato do que ler, e nenhum hash. E
 * o mesmo criterio de todo sistema de build. So quem mudou de verdade e lido e
 * comparado.
 *
 * Um arquivo so em `historico/vista.json`, e nao um campo por indice de
 * arquivo: ler um JSON por fonte custaria quase o mesmo que ler a fonte.
 * @param {string} projeto
 */
function lerVista(projeto) {
  const base = pastaDoProjeto(projeto);
  if (!base) return {};
  try {
    const d = JSON.parse(fs.readFileSync(path.join(base, ARQUIVO_VISTA), 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} projeto
 * @param {unknown} vista
 */
function gravarVista(projeto, vista) {
  const base = pastaDoProjeto(projeto);
  if (!base) return;
  try {
    fs.mkdirSync(base, { recursive: true });
    const alvo = path.join(base, ARQUIVO_VISTA);
    fs.writeFileSync(`${alvo}.tmp`, JSON.stringify(vista), 'utf8');
    fs.renameSync(`${alvo}.tmp`, alvo);
  } catch (e) {
    log.debug('[historico] vista nao gravada:', e instanceof Error ? e.message : e);
  }
}

/**
 * `stat` de um arquivo reduzido ao que a vista compara.
 * @param {string} abs
 */
function marcaDoDisco(abs) {
  try {
    const st = fs.statSync(abs);
    return { mtimeMs: Math.round(st.mtimeMs), size: st.size };
  } catch {
    return null;
  }
}

/**
 * @param {{ mtimeMs: number, size: number } | null | undefined} a
 * @param {{ mtimeMs: number, size: number } | null | undefined} b
 */
function mesmaMarca(a, b) {
  return !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;
}
const MAX_ARQUIVOS_POR_PONTO = 2000;
const PULAR_PASTAS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'components', 'Temp', 'Backup', '.vite', '.aurora', '.slang',
]);

/**
 * As fontes do projeto, em caminho absoluto. Melhor esforco e com teto.
 * @param {string} projeto
 * @param {number} [teto]
 */
function fontesDoProjeto(projeto, teto = MAX_ARQUIVOS_POR_PONTO) {
  /** @type {string[]} */
  const saida = [];
  const andar = (/** @type {string} */ dir, /** @type {number} */ profundidade) => {
    if (saida.length >= teto || profundidade > 12) return;
    let entradas;
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      if (saida.length >= teto) return;
      const alvo = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (PULAR_PASTAS.has(e.name) || e.name.startsWith('.')) continue;
        andar(alvo, profundidade + 1);
      } else if (e.isFile()) {
        saida.push(alvo);
      }
    }
  };
  andar(path.resolve(projeto), 0);
  return saida;
}

/**
 * O estado do projeto reduzido a um texto: cada arquivo com a versao que vale
 * agora. Dois pontos com a mesma assinatura apontam para o mesmo lugar.
 * @param {string} projeto
 * @param {string[]} arquivos
 */
function assinaturaDoEstado(projeto, arquivos) {
  const partes = [];
  for (const rel of arquivos.slice().sort()) {
    const pasta = pastaDoArquivo(projeto, rel);
    if (!pasta) continue;
    const versoes = lerIndice(pasta).versoes;
    const atual = versoes.length ? versoes[versoes.length - 1].id : '';
    partes.push(`${rel}:${atual}`);
  }
  return crypto.createHash('sha1').update(partes.join('\n'), 'utf8').digest('hex');
}

/**
 * O ponto mais recente ja gravado, ou null.
 * @param {string} dir
 */
function ultimoPonto(dir) {
  try {
    const nomes = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    if (!nomes.length) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, nomes[nomes.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} projeto */
function pastaDePontos(projeto) {
  const base = pastaDoProjeto(projeto);
  return base ? path.join(base, PASTA_PONTOS) : null;
}

/**
 * Abre um ponto de restauracao. Sincrono e de melhor esforco.
 *
 * @param {string} projeto
 * @param {{ rotulo?: string|null, motivo?: string|null, mensagemId?: string|null, manual?: boolean, agora?: number }} [meta]
 */
function criarPonto(projeto, { rotulo = null, motivo = null, mensagemId = null, manual = false, agora = Date.now() } = {}) {
  const dir = pastaDePontos(projeto);
  if (!dir) return { ok: false, erro: 'projeto invalido' };

  const arquivos = [];
  const vista = lerVista(projeto);
  let vistaMudou = false;
  for (const abs of fontesDoProjeto(projeto)) {
    const rel = relativoAoProjeto(projeto, abs);
    if (!rel) continue;
    const chave = chaveDe(rel);
    const marca = marcaDoDisco(abs);
    // Nao mudou de tamanho nem de data desde a ultima olhada: ja tem versao,
    // e nem e lido. E isto que faz o segundo ponto custar um stat por arquivo
    // em vez de uma leitura e um hash.
    if (marca && mesmaMarca(vista[chave], marca)) { arquivos.push(rel); continue; }

    let conteudo;
    try { conteudo = fs.readFileSync(abs); } catch { continue; }
    // Garante versao para o arquivo. Conteudo repetido nao vira versao nova.
    const r = gravarVersao(projeto, abs, conteudo, { origem: 'ponto', agora });
    if (!r.ok) continue;
    arquivos.push(rel);
    if (marca) { vista[chave] = marca; vistaMudou = true; }
  }
  if (vistaMudou) gravarVista(projeto, vista);

  fs.mkdirSync(dir, { recursive: true });
  ocultarPastaDeSistemaEm(dir);

  /*
   * Ponto identico ao ultimo nao vira ponto novo.
   *
   * Os gatilhos sao automaticos: um por compilacao e um por mensagem para a
   * IA. Compilar cinco vezes seguidas sem editar nada produzia cinco pontos
   * apontando para o mesmo estado, e a lista de "volte para aqui" enchia de
   * linhas indistinguiveis. A deduplicacao de conteudo ja impedia as copias de
   * arquivo, mas nao os rotulos.
   *
   * A assinatura e o conjunto de (arquivo, versao atual) no instante: se ela
   * nao mudou, nao ha estado novo para onde voltar. Guardada no proprio ponto,
   * a comparacao custa uma leitura de JSON, e nao uma revarredura.
   *
   * O ponto MANUAL escapa disso: quem clicou em "marcar ponto" fez um gesto
   * deliberado e espera ver o resultado dele na lista, mesmo que o estado
   * ainda seja o mesmo de dois minutos atras.
   */
  const assinatura = assinaturaDoEstado(projeto, arquivos);
  if (!manual) {
    const ultimo = ultimoPonto(dir);
    if (ultimo && ultimo.assinatura && ultimo.assinatura === assinatura) {
      return { ok: true, id: ultimo.id, arquivos: arquivos.length, repetido: true };
    }
  }

  const id = idDe(agora);
  const ponto = {
    formato: 1,
    id,
    assinatura,
    quando: agora,
    /*
     * `motivo` e uma CHAVE, e `rotulo` e texto livre.
     *
     * A primeira versao guardava so `rotulo`, ja traduzido, no instante em que
     * o ponto nascia. O resultado apareceu na tela do Chrysthofer: um ponto
     * criado com a interface em ingles mostrava "marked by hand" para sempre,
     * e o "antes de voltar" estava escrito em portugues aqui dentro, entao
     * aparecia em portugues ate para quem usa em ingles. Rotulo de tela nao
     * pode ser gravado em disco.
     *
     * Agora o disco guarda o MOTIVO ('manual', 'compilar', 'voltar', 'pedido')
     * e quem mostra traduz. `rotulo` fica para o unico texto que e mesmo do
     * usuario e nao se traduz: o comeco do pedido que ele escreveu para a IA.
     */
    motivo: motivo || null,
    rotulo: rotulo ? String(rotulo).slice(0, 200) : null,
    mensagemId: mensagemId ? String(mensagemId).slice(0, 64) : null,
    arquivos,
  };
  const alvo = path.join(dir, `${id}.json`);
  fs.writeFileSync(`${alvo}.tmp`, JSON.stringify(ponto, null, 2), 'utf8');
  fs.renameSync(`${alvo}.tmp`, alvo);

  // Mesma poda do registro de execucoes: cinquenta cobre semanas de uso.
  try {
    const nomes = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    for (const velho of nomes.slice(0, Math.max(0, nomes.length - LIMITE_VERSOES))) {
      fs.unlinkSync(path.join(dir, velho));
    }
  } catch { /* poda e cortesia */ }

  return { ok: true, id, arquivos: arquivos.length };
}

/**
 * Os pontos gravados, do mais recente para o mais antigo.
 * @param {string} projeto
 */
function listarPontos(projeto) {
  const dir = pastaDePontos(projeto);
  if (!dir || !fs.existsSync(dir)) return { ok: true, pontos: [] };
  const pontos = [];
  for (const nome of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().reverse()) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8'));
      pontos.push({ id: d.id, quando: d.quando, motivo: d.motivo || null, rotulo: d.rotulo || null, mensagemId: d.mensagemId || null, arquivos: (d.arquivos || []).length });
    } catch { /* ponto ilegivel: nao derruba a lista */ }
  }
  return { ok: true, pontos };
}

/**
 * @param {string} projeto
 * @param {string} id
 */
function lerPonto(projeto, id) {
  const dir = pastaDePontos(projeto);
  if (!dir || !ID_VALIDO.test(String(id || ''))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')); }
  catch { return null; }
}

/**
 * A versao de um arquivo naquele instante: a mais recente com carimbo menor ou
 * igual ao do ponto. Puro, para o teste.
 *
 * @param {Array<{id:string, quando:number}>} versoes da mais antiga para a mais nova
 * @param {number} quando
 */
function versaoNoInstante(versoes, quando) {
  let escolhida = null;
  for (const v of versoes) {
    if (v.quando <= quando) escolhida = v;
    else break;
  }
  return escolhida;
}

/**
 * O que uma volta faria: quais arquivos mudam de conteudo e quais foram
 * criados depois do ponto. Calculado antes de mexer em qualquer coisa, para a
 * tela poder perguntar com numeros na mao.
 *
 * @param {string} projeto
 * @param {string} id
 * @returns {{ ok: true, quando: number, rotulo: string|null, restaurar: Array<{ arquivo: string, versao: string }>, novos: string[] } | { ok: false, erro: string }}
 */
function previaDoPonto(projeto, id) {
  const ponto = lerPonto(projeto, id);
  if (!ponto) return { ok: false, erro: 'ponto nao encontrado' };
  const doPonto = new Set((ponto.arquivos || []).map((/** @type {unknown} */ r) => String(r).toLowerCase()));

  const restaurar = [];
  for (const rel of (ponto.arquivos || [])) {
    const pasta = pastaDoArquivo(projeto, rel);
    if (!pasta) continue;
    const alvo = versaoNoInstante(lerIndice(pasta).versoes, ponto.quando);
    if (!alvo) continue;
    let atual = null;
    try { atual = fs.readFileSync(path.join(path.resolve(projeto), rel.split('/').join(path.sep)), 'utf8'); }
    catch { atual = null; }
    let guardado = null;
    try { guardado = fs.readFileSync(path.join(pasta, `${alvo.id}.txt`), 'utf8'); } catch { continue; }
    if (atual !== guardado) restaurar.push({ arquivo: rel, versao: alvo.id });
  }

  const novos = [];
  for (const abs of fontesDoProjeto(projeto)) {
    const rel = relativoAoProjeto(projeto, abs);
    if (rel && !doPonto.has(rel.toLowerCase())) novos.push(rel);
  }

  return { ok: true, quando: ponto.quando, rotulo: ponto.rotulo || null, restaurar, novos };
}

/**
 * Volta o projeto ao ponto.
 *
 * Antes de qualquer escrita, o estado de AGORA vira um ponto novo: voltar e
 * uma acao grande, e sem isso a propria volta seria o gesto sem volta. Quem se
 * arrepender de ter voltado acha o estado anterior na lista.
 *
 * @param {string} projeto
 * @param {string} id
 * @param {{ trashItem?: ((p: string) => Promise<void>) | null }} [deps]
 */
async function rebobinar(projeto, id, { trashItem = null } = {}) {
  const previa = previaDoPonto(projeto, id);
  if (!previa.ok) return previa;

  criarPonto(projeto, { motivo: 'voltar', manual: true, agora: Date.now() });

  let restaurados = 0;
  const falhas = [];
  for (const item of previa.restaurar) {
    const pasta = pastaDoArquivo(projeto, item.arquivo);
    const alvo = path.join(path.resolve(projeto), item.arquivo.split('/').join(path.sep));
    try {
      const texto = fs.readFileSync(path.join(pasta, `${item.versao}.txt`), 'utf8');
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(`${alvo}.tmp`, texto, 'utf8');
      fs.renameSync(`${alvo}.tmp`, alvo);
      restaurados += 1;
    } catch (e) {
      falhas.push(item.arquivo);
    }
  }

  let removidos = 0;
  for (const rel of previa.novos) {
    const alvo = path.join(path.resolve(projeto), rel.split('/').join(path.sep));
    try {
      if (trashItem) await trashItem(alvo);
      else fs.unlinkSync(alvo);
      removidos += 1;
    } catch {
      falhas.push(rel);
    }
  }

  return { ok: true, restaurados, removidos, falhas };
}

// ── os ganchos que files.js chama ───────────────────────────────────────────────────────

/**
 * Antes de uma gravacao pelo `write-file`: guarda o estado do disco se for a
 * primeira vez. Sincrono porque precisa acontecer ANTES de o arquivo mudar.
 * Nunca lanca.
 * @param {string|null} projeto
 * @param {string} arquivo
 */
function antesDeGravar(projeto, arquivo) {
  if (!projeto) return;
  try { guardarAntesSePrimeira(projeto, arquivo); }
  catch (e) { log.debug('[historico] antes-de-gravar falhou:', e instanceof Error ? e.message : e); }
}

/**
 * Depois de uma gravacao bem sucedida: guarda o que acabou de ser gravado.
 * Fora do caminho critico (setImmediate), porque o `write-file` ja respondeu
 * ao editor e o historico nao pode atrasar o proximo salvar. Nunca lanca.
 * @param {string|null} projeto
 * @param {string} arquivo
 * @param {string|Buffer} conteudo
 * @param {string} [origem]
 */
function depoisDeGravar(projeto, arquivo, conteudo, origem = 'salvar') {
  if (!projeto) return;
  setImmediate(() => {
    try {
      const r = gravarVersao(projeto, arquivo, conteudo, { origem });
      // A vista aprende a marca do arquivo recem-gravado, senao o proximo ponto
      // o releria para descobrir que ja tem essa versao.
      if (r.ok) {
        const rel = relativoAoProjeto(projeto, arquivo);
        const marca = rel ? marcaDoDisco(arquivo) : null;
        if (rel && marca) {
          const vista = lerVista(projeto);
          vista[chaveDe(rel)] = marca;
          gravarVista(projeto, vista);
        }
      }
    } catch (e) { log.debug('[historico] gravar versao falhou:', e instanceof Error ? e.message : e); }
  });
}

/**
 * Antes de apagar: a ultima copia do arquivo vai para o historico, senao ela
 * iria junto com o arquivo. Sincrono porque o unlink vem logo depois.
 * @param {string|null} projeto
 * @param {string} arquivo
 */
function antesDeApagar(projeto, arquivo) {
  if (!projeto) return;
  try {
    const atual = fs.readFileSync(arquivo);
    gravarVersao(projeto, arquivo, atual, { origem: 'apagar' });
  } catch (e) {
    log.debug('[historico] antes-de-apagar falhou:', e instanceof Error ? e.message : e);
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────────

function register() {
  const { ipcMain } = require('electron');
  const { spfDaJanela } = require('./project_paths');
  /** O projeto da janela que pediu, nunca um caminho vindo do renderer. */
  const projetoDe = (/** @type {any} */ event) => {
    const spf = spfDaJanela(event);
    return spf ? path.dirname(spf) : null;
  };
  ipcMain.handle('historico:listar', (event, arquivo) => listar(projetoDe(event) || '', String(arquivo || '')));
  ipcMain.handle('historico:ler', (event, arquivo, id) => ler(projetoDe(event) || '', String(arquivo || ''), String(id || '')));
  ipcMain.handle('historico:ponto-criar', (event, meta) => {
    const projeto = projetoDe(event);
    if (!projeto) return { ok: false, erro: 'sem projeto' };
    try { return criarPonto(projeto, meta || {}); }
    catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
  });
  ipcMain.handle('historico:ponto-listar', (event) => {
    const projeto = projetoDe(event);
    return projeto ? listarPontos(projeto) : { ok: true, pontos: [] };
  });
  ipcMain.handle('historico:ponto-previa', (event, id) => {
    const projeto = projetoDe(event);
    if (!projeto) return { ok: false, erro: 'sem projeto' };
    return previaDoPonto(projeto, String(id || ''));
  });
  ipcMain.handle('historico:ponto-voltar', async (event, id) => {
    const projeto = projetoDe(event);
    if (!projeto) return { ok: false, erro: 'sem projeto' };
    const { shell } = require('electron');
    // Lixeira, e nao unlink: voltar ja e uma acao grande, e apagar de vez o
    // que a IA criou trocaria um arrependimento por outro.
    return rebobinar(projeto, String(id || ''), { trashItem: (p) => shell.trashItem(p) });
  });
}

module.exports = {
  register,
  // ganchos
  antesDeGravar,
  depoisDeGravar,
  antesDeApagar,
  // API
  gravarVersao,
  guardarAntesSePrimeira,
  lerVista,
  criarPonto,
  assinaturaDoEstado,
  listarPontos,
  previaDoPonto,
  rebobinar,
  versaoNoInstante,
  fontesDoProjeto,
  listar,
  ler,
  // puros, para teste
  relativoAoProjeto,
  chaveDe,
  podarVersoes,
  conteudoGuardavel,
  pastaDoProjeto,
  LIMITE_VERSOES,
};
