/**
 * path_rules.ts: o que um caminho de projeto pode conter.
 *
 * A AURORA aceitava criar projeto em qualquer pasta, e o erro só aparecia
 * depois, vindo de uma ferramenta de linha de comando, com uma mensagem que não
 * apontava a causa. O aluno lia "cannot open file" e não tinha como ligar aquilo
 * ao `&` no nome da pasta.
 *
 * A causa é que o fluxo do SAPHO atravessa muitas mãos antes de virar hardware:
 * `cmd.exe` e o PowerShell do terminal, o `bash` e o `make` do MSYS por baixo do
 * Verilator e do cocotb, o Icarus, o Yosys, o GTKWave e o Surfer. Cada um trata
 * um punhado de caracteres como sintaxe, e não como texto, e basta um deles não
 * citar o caminho para o comando quebrar longe daqui.
 *
 * Por isso a regra é conservadora: recusa o que quebra em ALGUM elo, mesmo que
 * a maioria aguente. Um projeto que não abre no meio de uma aula custa mais do
 * que renomear uma pasta antes de começar.
 *
 * Isto é aritmética de texto, sem DOM e sem disco, para poder ser testado.
 */

/**
 * Caracteres que viram sintaxe em algum elo da cadeia.
 *
 *   & | < > ^     operadores do cmd.exe
 *   $ ` ! ; ( )   expansão e controle no bash e no PowerShell
 *   % # ' " { }   variável do cmd, comentário do Tcl no GTKWave, citação
 *   [ ] * ?       glob, que o make e o bash expandem sozinhos
 *   , =           separador em argumento de algumas ferramentas
 */
const PROIBIDOS = ['&', '|', '<', '>', '^', '$', '`', '!', ';', '(', ')',
  '%', '#', "'", '"', '{', '}', '[', ']', '*', '?', ',', '='];

/** Nomes que o Windows reserva, com ou sem extensão. */
const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Resultado de uma análise. `motivo` é um código estável, para o chamador
 * traduzir; `detalhe` traz o trecho problemático, porque apontar o caractere é
 * o que resolve o problema para quem está lendo o aviso.
 */
export type Analise = { ok: boolean; motivo?: string; detalhe?: string };

/**
 * Analisa um caminho de projeto.
 *
 * @param caminho caminho absoluto, ou só o nome da pasta
 */
export function analisarCaminhoDeProjeto(caminho: unknown): Analise {
  const bruto = String(caminho == null ? '' : caminho);
  if (!bruto.trim()) return { ok: false, motivo: 'vazio' };

  // A unidade do Windows (`C:`) é legítima e traz dois-pontos e barra
  // invertida; o resto do caminho é que passa pela regra.
  const semUnidade = bruto.replace(/^[a-zA-Z]:[\\/]/, '');

  // Caractere de controle vindo de colagem. Comparar por codigo, e nao por
  // classe de regex, porque a classe com literais de controle e recusada
  // pelo lint e por bons motivos: ela e ilegivel.
  if ([...semUnidade].some((c) => c.charCodeAt(0) < 32)) return { ok: false, motivo: 'controle' };

  const achados = PROIBIDOS.filter((c) => semUnidade.includes(c));
  if (achados.length) {
    return { ok: false, motivo: 'caractere', detalhe: achados.join(' ') };
  }

  // Acento não quebra o Windows, mas quebra ferramenta do MSYS compilada sem
  // suporte a UTF-8, que é o caso de parte da cadeia. Fora do ASCII, recusa.
  const foraDoAscii = [...semUnidade].filter((c) => c.charCodeAt(0) > 126);
  if (foraDoAscii.length) {
    return { ok: false, motivo: 'acento', detalhe: [...new Set(foraDoAscii)].join(' ') };
  }

  // Espaço duplo passa despercebido ao olho e some em argumento não citado,
  // então o caminho deixa de apontar para onde a pessoa acha que aponta.
  if (/ {2}/.test(semUnidade)) return { ok: false, motivo: 'espacoDuplo' };

  const partes = semUnidade.split(/[\\/]/).filter(Boolean);
  for (const parte of partes) {
    if (RESERVADOS.test(parte)) return { ok: false, motivo: 'reservado', detalhe: parte };
    if (parte !== parte.trim()) return { ok: false, motivo: 'bordas', detalhe: parte };
    if (parte.endsWith('.')) return { ok: false, motivo: 'pontoFinal', detalhe: parte };
  }

  return { ok: true };
}

/**
 * Só o nome do projeto, sem separador.
 *
 * Mais estreito que o caminho: o nome vira a pasta e o nome do `.spf`, e a
 * convenção do projeto (a mesma que a API da IA aplica em
 * `ciclo_do_projeto_ns.ts`) é letra ASCII, dígito, `_` e `-`. O caminho aceita
 * espaço simples para não barrar "Meus Projetos"; o nome não herda essa folga.
 */
export function analisarNomeDeProjeto(nome: unknown): Analise {
  const n = String(nome == null ? '' : nome);
  if (/[\\/]/.test(n)) return { ok: false, motivo: 'separador' };
  const doCaminho = analisarCaminhoDeProjeto(n);
  if (!doCaminho.ok) return doCaminho;
  const fora = [...new Set([...n].filter((c) => !/[A-Za-z0-9_-]/.test(c)))];
  if (fora.length) {
    return { ok: false, motivo: 'nome', detalhe: fora.map((c) => (c === ' ' ? 'espaço' : c)).join(' ') };
  }
  return { ok: true };
}

/** Mensagens em português, prontas para a interface. */
const MOTIVOS: Record<string, (d?: string) => string> = {
  vazio: () => 'Informe um caminho.',
  controle: () => 'O caminho tem caracteres invisíveis. Digite-o de novo.',
  caractere: (d) => `O caminho não pode conter ${d}. `
    + 'As ferramentas de compilação tratam esses caracteres como comando, '
    + 'e o erro apareceria só na hora de compilar.',
  acento: (d) => `O caminho não pode ter acento nem ${d}. `
    + 'Parte do toolchain não lê caminho fora do ASCII.',
  espacoDuplo: () => 'O caminho tem dois espaços seguidos. Use um só.',
  reservado: (d) => `"${d}" é um nome reservado pelo Windows.`,
  bordas: (d) => `"${d}" começa ou termina com espaço.`,
  pontoFinal: (d) => `"${d}" termina com ponto, o que o Windows não guarda.`,
  separador: () => 'O nome não pode conter barra.',
  nome: (d) => `O nome do projeto só pode ter letras sem acento, números, _ e -. Tire: ${d}.`,
};

/** Texto pronto para um resultado de análise. */
export function explicar(resultado: Analise | null | undefined): string {
  if (!resultado || resultado.ok) return '';
  const f = resultado.motivo ? MOTIVOS[resultado.motivo] : undefined;
  return f ? f(resultado.detalhe) : 'Caminho inválido.';
}
