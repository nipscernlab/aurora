/**
 * linha_do_cmd.ts: como rodar um `.cmd` (o atalho que o npm instala para o
 * `claude` e o `codex` globais) sem que o cmd.exe leia os argumentos.
 *
 * Desde o Node 20.12 um `.cmd` so roda pelo cmd.exe. A AURORA chamava
 * `spawn('cmd.exe', ['/d', '/s', '/c', exe, ...args])`, e o Node so poe
 * aspas num argumento com espaco: um projeto em `C:\R&D\proj` chegava ao
 * cmd.exe como `--add-dir C:\R&D\proj`, e o que vinha depois do `&` virava
 * outro comando. `%VAR%` no caminho era expandido.
 *
 * Aqui a linha e montada inteira e vai ao spawn com
 * `windowsVerbatimArguments`, que o Node repassa sem mexer. Cada argumento
 * leva as aspas da regra do CommandLineToArgvW, e depois todo caractere que o
 * cmd.exe interpreta ganha um `^` na frente. Ganha dois, porque o `.cmd`
 * repassa os argumentos com `%*`, e o cmd.exe le a linha de novo dentro dele.
 * E o metodo do pacote cross-spawn.
 *
 * Quebra de linha nao tem escape no cmd.exe: ela encerra o comando. Um
 * argumento com quebra de linha e recusado, e quem chama manda esse texto
 * pela entrada padrao.
 */

const ESPECIAIS = /([()\][%!^"`<>&|;, *?])/g;

/** O caminho do executavel: sem aspas, com os especiais escapados. */
function escaparComando(exe: string): string {
  return exe.replace(ESPECIAIS, '^$1');
}

/** Um argumento: aspas do argv, depois os especiais escapados duas vezes. */
export function escaparArgumento(arg: string): string {
  if (/[\r\n]/.test(arg)) {
    throw new Error('um argumento com quebra de linha nao passa pelo cmd.exe');
  }
  let s = arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/, '$1$1');
  s = `"${s}"`;
  return s.replace(ESPECIAIS, '^$1').replace(ESPECIAIS, '^$1');
}

/**
 * O comando e as opcoes do spawn para rodar `exe` (um `.cmd` ou `.bat`) com
 * `args`, cada argumento chegando ao programa exatamente como esta no vetor.
 */
export function viaCmd(exe: string, args: readonly string[]): {
  cmd: string; args: string[]; windowsVerbatimArguments: true;
} {
  const linha = [escaparComando(exe), ...args.map(escaparArgumento)].join(' ');
  return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', `"${linha}"`], windowsVerbatimArguments: true };
}
