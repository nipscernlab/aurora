/**
 * De uma linha de saida da toolchain para um lugar no codigo.
 *
 * O terminal despeja o texto cru do Icarus, do Verilator, dos compiladores do
 * yanc e do cocotb, e achar o erro era trabalho manual. Este modulo responde
 * uma coisa so: nesta linha de texto, onde ha uma referencia a arquivo, linha e
 * coluna, e ate que ponto ela vai. Quem desenha o link e abre o editor e o
 * terminal_module; aqui nao ha DOM, e por isso da para testar com as saidas de
 * verdade das ferramentas, que foi como estes padroes foram escritos.
 *
 * POR FERRAMENTA, e nao uma expressao regular so. Cada uma imprime de um jeito,
 * e as diferencas nao sao cosmeticas:
 *
 *   Icarus     C:/proj/Hardware/top.v:5: error: Invalid module item.
 *              Caminho, linha, e NENHUMA coluna.
 *
 *   Verilator  %Error: C:/proj/Sim/tb.v:5:3: syntax error, unexpected assign
 *              Prefixo proprio, linha E coluna, e caminho que sai com as duas
 *              barras misturadas (`C:/proj/Sim\tb.v`), porque ele junta o que
 *              recebeu com o que descobriu.
 *
 *   yanc       Erro na linha 2: se voce declarar a variavel 'y' eu agradeco.
 *              Erro de sintaxe na linha 3. Voce e uma pessoa confusa!
 *              Sem arquivo nenhum: quem sabe qual e o .cmm e a AURORA, que
 *              acabou de mandar compilar. As seis formas da mensagem e as duas
 *              linguas saem do proprio codigo do compilador, conferidas na
 *              arvore do yanc.
 *
 *   cocotb     File "C:/proj/Sim/tb_soma.py", line 42, in teste
 *              Formato do Python, com o caminho entre aspas.
 *
 * A ARMADILHA que decide o desenho: caminho do Windows tem dois-pontos no
 * comeco (`C:`) e pode ter ESPACO no meio. Uma regra unica que aceite espaco
 * captura frase inteira ("ao abrir o arquivo x.v" vira caminho), e uma que
 * recuse espaco perde `C:\Meus Projetos\top.v`, que e o caso comum de quem usa
 * a pasta de documentos. Por isso sao tres regras com contextos diferentes:
 * ancorada no inicio da linha o caminho pode ter espaco, porque ali ele e o
 * comeco da mensagem e nao ha frase antes dele; no meio do texto ele nao pode,
 * porque nao ha como saber onde comeca; e entre aspas pode, porque as aspas
 * dizem onde comeca e onde termina.
 */

/** Extensoes que a AURORA sabe abrir num editor. */
const EXT = 'v|sv|svh|vh|vlt|cmm|asm|mif|py|c|cpp|h|hpp|json|txt';

/* Corpo de caminho SEM espaco, para uso no meio de uma frase. O `(?:[A-Za-z]:)?`
   e a letra de unidade, e ela precisa vir antes da proibicao de dois-pontos,
   senao `C:` corta o caminho no primeiro caractere. */
const SEM_ESPACO = `(?:[A-Za-z]:)?[^\\s:*?"<>|]+?\\.(?:${EXT})`;
/* Corpo COM espaco, so onde o contexto delimita. */
const COM_ESPACO = `(?:[A-Za-z]:)?[^:*?"<>|\\r\\n]+?\\.(?:${EXT})`;

/**
 * Os reconhecedores, em ordem de prioridade. O primeiro que casar numa posicao
 * decide, e por isso o do Verilator vem antes do generico: os dois casam o
 * mesmo trecho, e so o primeiro sabe dizer de que ferramenta veio.
 *
 * `re` precisa ter a flag `g` e expor os grupos que `campos` nomeia.
 */
export const RECONHECEDORES = [
  {
    // Verilator: `%Error: <caminho>:<linha>:<coluna>: mensagem`, e as variantes
    // `%Warning-WIDTH:` e `%Error-UNSUPPORTED:`.
    ferramenta: 'verilator',
    re: new RegExp(`^\\s*%(?:Error|Warning)[A-Za-z-]*:\\s*(${COM_ESPACO}):(\\d+):(\\d+):`, 'gm'),
    campos: { arquivo: 1, linha: 2, coluna: 3 },
  },
  {
    // Estilo GCC, no comeco da linha: slang, yosys, verible, clang-format e o
    // proprio Verilator quando repete o local numa linha de continuacao.
    ferramenta: 'gcc',
    re: new RegExp(`^\\s*(${COM_ESPACO}):(\\d+):(\\d+)(?=[:\\s]|$)`, 'gm'),
    campos: { arquivo: 1, linha: 2, coluna: 3 },
  },
  {
    // Icarus: caminho e linha, sem coluna, no comeco da linha.
    ferramenta: 'icarus',
    re: new RegExp(`^\\s*(${COM_ESPACO}):(\\d+)(?=[:\\s,]|$)`, 'gm'),
    campos: { arquivo: 1, linha: 2 },
  },
  {
    // cocotb e qualquer traceback de Python.
    ferramenta: 'python',
    re: new RegExp(`File "(${COM_ESPACO})", line (\\d+)`, 'g'),
    campos: { arquivo: 1, linha: 2 },
  },
  {
    // Estilo GCC no MEIO da frase, onde o caminho nao pode ter espaco.
    ferramenta: 'gcc',
    re: new RegExp(`(?:^|[\\s"'(\\[])(${SEM_ESPACO}):(\\d+)(?::(\\d+))?(?=[:\\s,)\\]]|$)`, 'g'),
    campos: { arquivo: 1, linha: 2, coluna: 3 },
  },
  {
    // yanc, as duas linguas. Sem arquivo: quem resolve isso e o chamador, com
    // o .cmm que acabou de mandar compilar.
    //
    // O gatilho e a palavra de severidade ANTES da referencia, e nao a
    // referencia sozinha: "linha 3" aparece em texto corrido da propria
    // interface, e transformar toda ocorrencia em link daria link que nao leva
    // a lugar nenhum. As seis formas do compilador cabem nas duas alternativas
    // abaixo porque todas comecam por Erro/Error/Atencao/Warning e terminam em
    // "linha N" ou "line N".
    ferramenta: 'yanc',
    re: /(?:Erro|Error|Aten\u00e7\u00e3o|Atencao|Warning|Syntax error)[^\r\n]{0,40}?\b(?:linha|line)\s+(\d+)/g,
    campos: { linha: 1 },
  },
];

/**
 * Todas as referencias a codigo numa linha de texto, da esquerda para a
 * direita, sem sobreposicao.
 *
 * @param texto uma linha da saida da ferramenta
 * @returns {Array<{inicio:number, fim:number, texto:string, arquivo:string|null,
 *                  linha:number, coluna:number|null, ferramenta:string}>}
 */
export interface Localizacao {
  inicio: number;
  fim: number;
  texto: string;
  arquivo: string | null;
  linha: number;
  coluna: number | null;
  ferramenta: string;
}

export function localizacoesNaLinha(texto: string): Localizacao[] {
  if (!texto || typeof texto !== 'string') return [];
  const achados: Localizacao[] = [];

  for (const r of RECONHECEDORES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(texto)) !== null) {
      // O grupo do arquivo pode nao existir (yanc), e a captura pode comecar
      // depois do inicio do casamento (o delimitador do padrao do meio da
      // frase). Ancorar pelo grupo, e nao pelo casamento inteiro, e o que
      // impede o link de comer o espaco ou a aspa anterior.
      const alvo = r.campos.arquivo ? m[r.campos.arquivo] : m[0];
      const inicioAlvo = r.campos.arquivo
        ? texto.indexOf(alvo, m.index)
        : m.index;
      const linha = Number(m[r.campos.linha]);
      if (!Number.isFinite(linha) || linha <= 0) continue;

      const coluna = r.campos.coluna && m[r.campos.coluna] ? Number(m[r.campos.coluna]) : null;
      // O trecho que vira link vai do inicio do alvo ate o fim do numero da
      // linha (ou da coluna), e nao ate o fim da mensagem.
      const cauda = coluna !== null
        ? `${linha}:${coluna}`
        : String(linha);
      const posCauda = texto.indexOf(cauda, inicioAlvo + (r.campos.arquivo ? alvo.length : 0));
      const fim = posCauda >= 0 ? posCauda + cauda.length : m.index + m[0].length;

      const item: Localizacao = {
        // Com arquivo, o link comeca no caminho; sem arquivo (yanc), comeca na
        // palavra "linha", e nao no "Erro" que veio antes dela.
        inicio: r.campos.arquivo ? inicioAlvo : posDaPalavra(texto, m),
        fim,
        arquivo: r.campos.arquivo ? alvo : null,
        linha,
        coluna,
        ferramenta: r.ferramenta,
        texto: '',
      };
      if (item.inicio < 0 || item.fim <= item.inicio) continue;
      // Sem sobreposicao: o primeiro reconhecedor que cobriu aquele trecho
      // ganha, e e por isso que a ordem da lista importa.
      if (achados.some((a) => item.inicio < a.fim && a.inicio < item.fim)) continue;
      item.texto = texto.slice(item.inicio, item.fim);
      achados.push(item);
    }
  }

  return achados.sort((a, b) => a.inicio - b.inicio);
}

/* ── de localizacao para PROBLEMA ──────────────────────────────────

   Um link precisa saber ONDE; um marcador no editor precisa saber tambem O QUE
   e QUAO GRAVE. As duas coisas se leem da mesma linha de texto, e por isso a
   leitura mora aqui, junto do resto do que se sabe sobre cada ferramenta.

   Severidade: cada uma anuncia do seu jeito, e o `%Warning-WIDTH` do Verilator
   e o exemplo de por que nao serve procurar a palavra solta no meio do texto.
   Uma mensagem de erro pode CONTER a palavra "warning" (e vice-versa), entao o
   que vale e a marca da ferramenta, no lugar onde ela a imprime. */

/** A palavra de severidade de cada ferramenta, no formato que ela usa. */
const SEVERIDADE: Array<[RegExp, 'erro' | 'aviso']> = [
  // Verilator, antes do resto: `%Warning-WIDTH:` tem "Warning" com sufixo.
  [/^\s*%Warning/i, 'aviso'],
  [/^\s*%Error/i, 'erro'],
  // Estilo GCC: a palavra vem depois do local, como `:12:3: warning: ...`.
  [/:\s*(?:warning|aten\u00e7\u00e3o|atencao)\s*:/i, 'aviso'],
  [/:\s*(?:error|erro|fatal)\s*:/i, 'erro'],
  // yanc: a palavra abre a mensagem.
  [/^\s*(?:Aten\u00e7\u00e3o|Atencao|Warning)\b/i, 'aviso'],
  [/^\s*(?:Erro|Error|Syntax error)\b/i, 'erro'],
];

/**
 * Erro ou aviso? Na duvida, ERRO.
 *
 * Chamar erro o que era aviso custa um marcador vermelho a mais; chamar aviso
 * o que era erro esconde o que trava a compilacao. O primeiro engano se ve e se
 * corrige, o segundo nao.
 *
 */
export function severidadeDaLinha(texto: string): 'erro'|'aviso' {
  const t = String(texto || '');
  for (const [re, nivel] of SEVERIDADE) if (re.test(t)) return nivel;
  return 'erro';
}

/**
 * A mensagem, sem o local que ja virou link.
 *
 * O que sobra depois de tirar o trecho da localizacao, sem a pontuacao e os
 * prefixos de severidade que a coluna do marcador ja diz de outro jeito. Linha
 * que so tinha o local fica com o texto inteiro, porque marcador sem mensagem
 * nao explica nada.
 *
 */
export function mensagemDoProblema(texto: string, loc: { inicio: number; fim: number; }) {
  const t = String(texto || '');
  // So o que vem DEPOIS do local, nunca o de antes costurado com o de depois.
  // Costurar parecia preservar mais texto e produzia frase quebrada:
  // `File "x.py", line 42, in teste` virava `File " , in teste`, e
  // `Erro na linha 2: ...` virava `Erro na  : ...`. Em todas as ferramentas o
  // que interessa esta a direita; a esquerda so ha o prefixo que a coluna de
  // severidade ja diz de outro jeito.
  const resto = t.slice(loc.fim)
    .replace(/^[-:,\s]+/, '')
    .replace(/^(?:error|erro|warning|aten\u00e7\u00e3o|atencao|fatal)\s*:\s*/i, '')
    .trim();
  // Linha que era SO o local nao vira marcador mudo: sem mensagem, mostra a
  // linha inteira, que ao menos diz de onde veio.
  return resto.length >= 3 ? resto : t.trim();
}

/**
 * Os problemas de uma linha de saida: onde, o que e quao grave.
 *
 * `cmmPadrao` e o arquivo que a AURORA acabou de mandar compilar, e existe por
 * causa do yanc, que diz a linha e nao diz o arquivo. Sem ele, a mensagem do
 * compilador de C± continua sendo so texto no terminal.
 *
 */
export function problemasNaLinha(texto: string, { cmmPadrao = null }: { cmmPadrao?: string|null; } = {}) {
  const severidade = severidadeDaLinha(texto);
  const saida = [];
  for (const loc of localizacoesNaLinha(texto)) {
    const arquivo = loc.arquivo || cmmPadrao;
    if (!arquivo) continue;
    saida.push({
      arquivo,
      linha: loc.linha,
      coluna: loc.coluna,
      severidade,
      mensagem: mensagemDoProblema(texto, loc),
      ferramenta: loc.ferramenta,
    });
  }
  return saida;
}

/** Onde comeca o "linha N" dentro do casamento do yanc. */
function posDaPalavra(texto: string, m: RegExpExecArray): number {
  const dentro = /(?:linha|line)\s+\d+/i.exec(m[0]);
  return dentro ? m.index + dentro.index : m.index;
}

const escapar = (s: unknown) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A mesma linha, com as referencias viradas em `<span class="line-link">`.
 *
 * Mora aqui, e nao no terminal, por dois motivos. O primeiro e teste: assim da
 * para conferir a marcacao sem carregar o terminal inteiro, que arrasta Monaco
 * e componentes. O segundo e seguranca: o texto que NAO e link precisa ser
 * escapado, porque ele vem de arquivo do usuario e termina num `innerHTML`, e
 * juntar "escapar" e "marcar" numa funcao so e o que impede alguem de escapar
 * um pedaco e esquecer o outro.
 *
 * O clique e o `title` sao do terminal; aqui saem so os dados de que ele
 * precisa: `data-line`, `data-col` quando a ferramenta deu, e `data-file`
 * quando ela disse qual e.
 */
export function comLinks(texto: string, { titulo }: { titulo?: (loc: Localizacao) => string } = {}): string {
  const partes = [];
  let pos = 0;
  for (const loc of localizacoesNaLinha(texto)) {
    partes.push(escapar(texto.slice(pos, loc.inicio)));
    const t = titulo ? titulo(loc) : '';
    partes.push(
      `<span class="line-link"${t ? ` title="${escapar(t)}"` : ''}`
      + ` data-line="${loc.linha}"`
      + (loc.coluna ? ` data-col="${loc.coluna}"` : '')
      + (loc.arquivo ? ` data-file="${escapar(loc.arquivo)}"` : '')
      + ' style="cursor: pointer; text-decoration: none; filter: brightness(1.4);">'
      + `${escapar(loc.texto)}</span>`,
    );
    pos = loc.fim;
  }
  partes.push(escapar(texto.slice(pos)));
  return partes.join('');
}
