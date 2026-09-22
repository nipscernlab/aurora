/**
 * spf_parse.ts: ler um `.spf` tolerando sujeira.
 *
 * Um `.spf` e JSON, mas arquivo de verdade pega BOM, virgula sobrando ou
 * comentario solto: edicao a mao, outra ferramenta, escrita parcial, ou um
 * projeto que veio clonado de outra maquina. Um `JSON.parse` cru desiste em
 * qualquer um desses casos, e o projeto nao abre por causa de uma virgula.
 *
 * A regra e: estrito primeiro, e so falhando vem uma passada tolerante. Um
 * arquivo recuperavel abre; um arquivo de fato quebrado continua estourando,
 * porque abrir um projeto pela metade e pior do que nao abrir, e quem chama
 * registra o erro e cai nos padroes.
 *
 * Esta maquina de estados estava escrita DUAS VEZES, caractere por caractere:
 * uma no js/project/spf_store.ts, do lado do renderer, e outra no
 * main/ipc/project_paths.ts, do lado do processo principal, esta ultima com
 * um comentario dizendo "espelha o spf_store.ts". Sao os dois processos lendo
 * O MESMO ARQUIVO: se as copias divergissem, o projeto que abre de um lado
 * poderia nao abrir do outro, ou abrir diferente.
 *
 * Mora em js/ porque o processo principal carrega modulo daqui com `require`,
 * e o renderer nao carrega nada de main/.
 *
 * Compilado por `tsc` (npm run build:ts) num spf_parse.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

/**
 * Tira `//` e o bloco de comentario que estiverem FORA de texto entre aspas.
 *
 * O conteudo das aspas sai intacto, inclusive a barra dupla de uma URL, que e
 * a razao de isto ser uma maquina de estados e nao uma expressao regular: um
 * `"https://..."` dentro do `.spf` viraria `"https:` com qualquer regra que
 * so olhasse para as duas barras.
 */
export function stripJsonComments(s: string): string {
  let out = '';
  let inStr = false;
  let strCh = '';
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      // A barra invertida leva o proximo caractere junto, senao uma aspa
      // escapada dentro do texto fecharia o texto cedo demais.
      if (c === '\\') { out += s[i + 1] ?? ''; i++; } else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; strCh = c; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

/**
 * Le o conteudo de um `.spf`.
 *
 * Estrito primeiro. Falhando, tira os comentarios, o espaco do comeco (que e
 * onde o BOM aparece) e a virgula antes de `}` ou `]`, e tenta de novo.
 * Continua estourando se o arquivo estiver de fato quebrado.
 */
export function parseSpfTolerant(content: string): any {
  try {
    return JSON.parse(content);
  } catch (_strictErr) {
    const cleaned = stripJsonComments(content)
      .replace(/^\s+/, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  }
}
