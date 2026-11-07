/**
 * caminho_no_projeto.ts: a regra de "este caminho esta dentro do projeto
 * aberto", a mesma para ler e para escrever.
 *
 * Era so do `readFile` (arquivos_ns.ts). As ferramentas de escrita da Aurora
 * Intelligence (criar, apagar, renomear, importar) nao conferiam nada, e a
 * trava do main (main/ipc/files.js) aceita tambem o userData e o %TEMP%: a
 * assistente podia sobrescrever as chaves de API cifradas, as preferencias, o
 * log de auditoria e a configuracao MCP. Agora todas passam por aqui.
 *
 * Compilado por `tsc` (npm run build:ts) num caminho_no_projeto.js ao lado.
 */

/** O caminho resolvido, ou o motivo da recusa (texto que o modelo le). */
export type CaminhoNoProjeto = { ok: true; caminho: string } | { ok: false; erro: string };

/** Absoluto no Windows: com letra de unidade ou UNC. */
const absoluto = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');

/** Para comparar: barra invertida, sem barra no fim, minusculas. */
const normalizar = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/**
 * Resolve `caminho` contra a raiz do projeto e confere que fica dentro dela.
 *
 * Um caminho relativo vale a partir da raiz; um absoluto volta como veio, com
 * as barras que tinha. `..` e recusado em qualquer lugar, como o `readFile` ja
 * fazia. A raiz em si so conta com `raizConta`: ler a pasta do projeto e
 * inofensivo, apaga-la nao e.
 *
 * @param caminho o que o modelo mandou
 * @param raiz a pasta do projeto aberto, ou null sem projeto
 */
export function caminhoNoProjeto(
  caminho: unknown,
  raiz: string | null | undefined,
  { raizConta = false }: { raizConta?: boolean } = {},
): CaminhoNoProjeto {
  if (!raiz) return { ok: false, erro: 'No project open' };
  let alvo = String(caminho ?? '').trim();
  if (!alvo) return { ok: false, erro: 'path required' };
  if (alvo.includes('..')) return { ok: false, erro: 'path must not contain ".."' };
  if (!absoluto(alvo)) {
    const sep = raiz.includes('\\') ? '\\' : '/';
    alvo = `${raiz.replace(/[\\/]+$/, '')}${sep}${alvo.replace(/^[\\/]+/, '')}`;
  }
  // A barra no fim da comparacao impede que "MyProject2" passe por "MyProject".
  const r = normalizar(raiz);
  const t = normalizar(alvo);
  if (t === r) {
    return raizConta ? { ok: true, caminho: alvo } : { ok: false, erro: 'path is the project folder itself' };
  }
  if (!t.startsWith(r + '\\')) return { ok: false, erro: 'path is outside the open project folder' };
  return { ok: true, caminho: alvo };
}

/** So a pergunta: o caminho fica dentro do projeto? */
export function dentroDoProjeto(caminho: unknown, raiz: string | null | undefined): boolean {
  return caminhoNoProjeto(caminho, raiz).ok;
}
