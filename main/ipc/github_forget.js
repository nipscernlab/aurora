// @ts-check
/**
 * github_forget.js: apaga da máquina tudo que identifica a conta GitHub do
 * usuário.
 *
 * POR QUE EXISTE
 * --------------
 * A AURORA vai para as máquinas de um laboratório de graduação, compartilhadas
 * por turmas inteiras. O aluno conecta a conta dele no Git-D para entregar o
 * trabalho, e se sair sem limpar, a próxima pessoa que sentar naquela máquina
 * herda o acesso: `git push` continua funcionando com a credencial dele.
 *
 * Desconectar dentro da AURORA não resolvia isso. O botão de desconectar apaga
 * o cofre da própria AURORA e mais nada, e o problema não está aí: está no que
 * o `git` do Windows guarda por fora, no Gerenciador de Credenciais, por meio
 * do Git Credential Manager. Aquilo sobrevive a fechar a AURORA, a desinstalar
 * a AURORA e a trocar de usuário dentro dela.
 *
 * O QUE É APAGADO
 * ---------------
 *   1. Os cofres da AURORA (`userData/aurora-github.json` e
 *      `aurora-gitlab.json`), que guardam o token cifrado e o perfil.
 *   2. A credencial do host, pelo protocolo do próprio git (`git credential
 *      reject`). É o caminho correto porque conversa com QUALQUER helper que a
 *      máquina tenha configurado, seja o manager, o store ou o cache, em vez de
 *      supor um.
 *   3. `~/.git-credentials`, o arquivo do helper `store`. É texto puro com a
 *      senha dentro, e é o pior dos três para deixar para trás.
 *   4. As entradas do Gerenciador de Credenciais do Windows cujo alvo é do
 *      GitHub. Rede de segurança para quando o passo 2 não encontrou o helper.
 *
 * O QUE NÃO É APAGADO, E POR QUÊ
 * ------------------------------
 * Só entra o que é das forjas que a AURORA conhece: os hosts do GitHub, o
 * gitlab.com, e a instância GitLab que o usuário conectou, quando é própria.
 * A instância própria entra pelo que está guardado, nunca por curinga. Um
 * `cmdkey /delete` largo apagaria a credencial do Office, da rede da
 * universidade e do que mais estivesse ali, e uma ferramenta de limpeza que
 * leva junto o que não é dela é pior que não ter ferramenta.
 *
 * `user.name` e `user.email` do git também ficam: são identidade de autoria, e
 * não credencial. Apagá-los não protege ninguém e quebraria o próximo commit.
 * O painel mostra isso ao usuário para ele decidir.
 *
 * NENHUM SEGREDO PASSA POR AQUI
 * -----------------------------
 * Este módulo nunca lê o valor de uma credencial, só manda apagar. O relatório
 * devolvido diz o que saiu, nunca o que havia dentro, de modo que um log ou um
 * relato de erro não vaze o que a limpeza existia para proteger.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { app, ipcMain } = require('electron');
const log = require('electron-log');

const githubAuth = require('./github_auth');
let gitlabAuth = null;
try { gitlabAuth = require('./gitlab_auth'); } catch (_) { /* opcional */ }

/** Hosts tratados como "do GitHub". */
const HOSTS = ['github.com', 'gist.github.com', 'ssh.github.com'];

/** Hosts do GitLab publico. A instancia propria entra por `hostsDeForja`. */
const HOSTS_GITLAB = ['gitlab.com'];

/**
 * Todo host que a AURORA trata como forja, incluindo a instancia GitLab que o
 * usuario conectou, quando ela nao e a publica.
 *
 * A instancia propria entra pelo que esta GUARDADO, e nunca por curinga: um
 * padrao como "qualquer coisa terminada em gitlab" apagaria a credencial de um
 * dominio de terceiro, e apagar o que nao e nosso e o unico erro aqui que nao
 * da para desfazer.
 */
function hostsDeForja() {
  const lista = [...HOSTS, ...HOSTS_GITLAB];
  try {
    const proprio = gitlabAuth && typeof gitlabAuth.getHost === 'function'
      ? String(gitlabAuth.getHost() || '').toLowerCase().split(':')[0]
      : '';
    if (proprio && !lista.includes(proprio)) lista.push(proprio);
  } catch (_) { /* sem conta GitLab, so os publicos */ }
  return lista;
}

const TEMPO_LIMITE = 15000;

/**
 * Roda um comando sem shell e devolve o resultado, sem nunca lançar.
 *
 * `shell: false` é deliberado: os argumentos aqui carregam nome de host e de
 * alvo, e passar isso por um shell abriria injeção por um caminho que não tem
 * motivo nenhum para existir.
 */
function rodar(cmd, args, entrada) {
  return new Promise((resolve) => {
    let filho;
    try {
      filho = execFile(cmd, args, { timeout: TEMPO_LIMITE, windowsHide: true },
        (erro, stdout, stderr) => resolve({
          ok: !erro,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          erro: erro ? (erro.message || String(erro)) : null,
        }));
    } catch (e) {
      resolve({ ok: false, stdout: '', stderr: '', erro: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (entrada !== undefined && filho.stdin) {
      filho.stdin.on('error', () => { /* o processo morreu antes de ler */ });
      filho.stdin.end(entrada);
    }
  });
}

/** 1. O cofre da própria AURORA. */
function apagarCofre() {
  try {
    githubAuth.disconnect();
    // O cofre do GitLab sai junto: sao dois arquivos, mas uma promessa so.
    // Deixar um deles para tras seria pior do que nao ter o botao, porque o
    // usuario acreditaria que a maquina ficou limpa.
    try { if (gitlabAuth) gitlabAuth.disconnect(); } catch (_) { /* pode nao existir */ }
    return { passo: 'cofre-aurora', ok: true, detalhe: 'token e perfil removidos' };
  } catch (e) {
    return { passo: 'cofre-aurora', ok: false, detalhe: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 2. Pede ao git para esquecer a credencial de cada host.
 *
 * `git credential reject` fala com o helper configurado, seja qual for. Sem
 * helper configurado o git não faz nada e sai com zero, o que aqui é sucesso:
 * não havia o que apagar.
 */
async function rejeitarNoGit() {
  const feitos = [];
  for (const host of hostsDeForja()) {
    const r = await rodar('git', ['credential', 'reject'], `protocol=https\nhost=${host}\n\n`);
    feitos.push({ host, ok: r.ok, erro: r.erro });
  }
  const falhou = feitos.filter((f) => !f.ok);
  return {
    passo: 'git-credential-reject',
    ok: falhou.length === 0,
    detalhe: falhou.length
      ? `falhou em: ${falhou.map((f) => f.host).join(', ')}`
      : `${feitos.length} hosts pedidos ao helper do git`,
  };
}

/** 3. O arquivo do helper `store`, que guarda em texto puro. */
function apagarArquivoDeCredenciais() {
  const alvos = [
    path.join(os.homedir(), '.git-credentials'),
    path.join(os.homedir(), '.config', 'git', 'credentials'),
  ];
  const removidos = [];
  for (const p of alvos) {
    try {
      if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); removidos.push(p); }
    } catch (e) {
      return {
        passo: 'arquivo-git-credentials',
        ok: false,
        detalhe: `nao consegui remover ${p}: ${e instanceof Error ? e.message : e}`,
      };
    }
  }
  return {
    passo: 'arquivo-git-credentials',
    ok: true,
    detalhe: removidos.length ? `${removidos.length} arquivo(s) removido(s)` : 'nenhum encontrado',
  };
}

/**
 * Um alvo do Gerenciador de Credenciais é do GitHub?
 *
 * Extrai o HOST e compara por igualdade, em vez de procurar o texto dentro do
 * alvo. (Chamava-se `alvoEhDoGitHub` até 23/08/2026, quando o GitLab entrou:
 * o nome passou a mentir sobre o que a função decide.) Comparar por substring
 * parecia bastar e não bastava: um alvo forjado
 * como `git:https://github.com.exemplo.net` contém `//github.com` e passava,
 * então a limpeza apagaria a credencial de um domínio de terceiro. Apagar o que
 * não é nosso é o único erro aqui que não dá para desfazer.
 */
function alvoEhDeForja(alvo) {
  const t = String(alvo == null ? '' : alvo).trim().toLowerCase();
  if (!t) return false;

  // Formas reais do Gerenciador: `github.com`, `https://github.com`,
  // `git:https://github.com`, `LegacyGeneric:target=git:https://github.com`.
  let resto = t;
  const barras = resto.lastIndexOf('//');
  if (barras >= 0) resto = resto.slice(barras + 2);
  else if (resto.includes('=')) resto = resto.slice(resto.lastIndexOf('=') + 1);

  // Corta porta, caminho e credencial embutida; sobra o host.
  const host = resto.split('/')[0].split('?')[0].split('@').pop().split(':')[0];
  return hostsDeForja().includes(host);
}

/**
 * 4. Rede de segurança: varre o Gerenciador de Credenciais do Windows e apaga
 * só os alvos do GitHub.
 *
 * `cmdkey /list` imprime "Destino: xxx" ou "Target: xxx" conforme o idioma do
 * Windows, então a leitura aceita os dois.
 */
async function limparGerenciadorDoWindows() {
  if (process.platform !== 'win32') {
    return { passo: 'gerenciador-windows', ok: true, detalhe: 'nao se aplica fora do Windows' };
  }
  const lista = await rodar('cmdkey', ['/list']);
  if (!lista.ok) {
    return { passo: 'gerenciador-windows', ok: false, detalhe: 'nao consegui listar as credenciais' };
  }
  const alvos = [];
  for (const linha of lista.stdout.split(/\r?\n/)) {
    const m = linha.match(/^\s*(?:Destino|Target|Alvo)\s*:\s*(.+?)\s*$/i);
    if (m && alvoEhDeForja(m[1])) alvos.push(m[1]);
  }
  let removidos = 0;
  const falhas = [];
  for (const alvo of alvos) {
    const r = await rodar('cmdkey', [`/delete:${alvo}`]);
    if (r.ok) removidos += 1; else falhas.push(alvo);
  }
  return {
    passo: 'gerenciador-windows',
    ok: falhas.length === 0,
    detalhe: falhas.length
      ? `${removidos} removida(s), falhou em ${falhas.length}`
      : (removidos ? `${removidos} credencial(is) do GitHub removida(s)` : 'nenhuma encontrada'),
  };
}

/**
 * Executa a limpeza inteira.
 *
 * Um passo que falha NÃO interrompe os outros: deixar de apagar o arquivo em
 * texto puro porque o `cmdkey` não rodou seria o pior resultado possível. O
 * relatório volta com o que deu certo e o que não deu, para o usuário ver.
 */
async function esquecerTudo() {
  const passos = [];
  passos.push(apagarCofre());
  passos.push(await rejeitarNoGit());
  passos.push(apagarArquivoDeCredenciais());
  passos.push(await limparGerenciadorDoWindows());

  const falhas = passos.filter((p) => !p.ok);
  if (falhas.length) {
    // Sem detalhe de credencial no log: os passos so reportam contagem.
    log.warn('[github-forget] passos com falha:', falhas.map((f) => f.passo).join(', '));
  } else {
    log.info('[github-forget] limpeza concluida');
  }
  return { ok: falhas.length === 0, passos };
}

/** O que a limpeza NÃO toca, para o painel poder dizer ao usuário. */
function identidadeQueFica() {
  return {
    nota: 'user.name e user.email do git nao sao credenciais e continuam configurados.',
    caminhoCofre: path.join(app.getPath('userData'), 'aurora-github.json'),
    caminhoCofreGitlab: path.join(app.getPath('userData'), 'aurora-gitlab.json'),
  };
}

/**
 * A preferencia de limpar ao sair mora do lado do MAIN, e nao no localStorage.
 *
 * Quem executa a limpeza no encerramento e o processo principal, no before-quit,
 * quando o renderer ja pode ter ido embora. Guardar a escolha no localStorage
 * significaria pedi-la a uma janela que talvez nao exista mais, no exato momento
 * em que ela precisa ser lida.
 */
function caminhoPreferencia() {
  return path.join(app.getPath('userData'), 'aurora-github-exit.json');
}

/**
 * LIGADO por padrao, e a escolha e do cenario de uso, nao uma preferencia de
 * gosto. A AURORA roda em laboratorio, onde a mesma maquina passa por muitos
 * alunos no mesmo dia; deixar a credencial do GitHub ativa depende de cada um
 * lembrar de limpa-la, e quem esquece expoe a propria conta ao proximo que
 * sentar ali. O custo de errar para o lado de limpar e refazer o login; o de
 * errar para o outro lado e a conta de um aluno na mao de outro.
 *
 * Ausencia do arquivo significa "ninguem escolheu ainda", e ai vale o padrao.
 * So um `false` gravado explicitamente desliga a limpeza, o que preserva a
 * escolha de quem usa a IDE na propria maquina e foi ate as Configuracoes
 * desmarcar. Arquivo ilegivel tambem cai no padrao, de proposito: nesse estado
 * nao da para afirmar que alguem pediu para manter o acesso.
 *
 * O padrao, porem, so vale quando ha o que a AURORA tenha criado. Ate
 * 04/09/2026 a limpeza ao sair rodava em toda instalacao nova, conectada ou
 * nao, e apagava do Gerenciador de Credenciais do Windows a credencial do
 * github.com que o proprio usuario tinha guardado por fora, pelo git no
 * terminal ou pelo VS Code. Na maquina do mantenedor isso virava uma janela
 * "Connect to GitHub" a cada commit de outro programa, em todas as maquinas,
 * e cada teste de ponta a ponta que fechava a AURORA apagava a credencial de
 * novo. A regra agora: com a preferencia no padrao, a limpeza ao sair so roda
 * se uma conta de forja foi conectada NESTA instalacao (o cofre da AURORA tem
 * token), porque so entao existe algo que a AURORA deixou na maquina. O aluno
 * do laboratorio, que conecta pelo painel Git para entregar, continua coberto;
 * quem nunca conectou nao tem a credencial dos outros programas apagada. Um
 * `true` gravado explicitamente limpa sempre, como antes.
 */
/**
 * A decisao, separada da leitura do disco para poder ser testada sem Electron.
 * E o pedaco que regride em silencio: trocar o `!== false` por `=== true` numa
 * limpeza de codigo devolveria o padrao antigo sem falhar nada.
 *
 * @param {string|null} raw conteudo do arquivo, ou null se nao ha arquivo
 * @param {boolean} [contaConectada] se o cofre da AURORA tem alguma conta de
 *   forja; e o que o PADRAO devolve. Quem pergunta pela preferencia em si (o
 *   interruptor das Configuracoes) nao passa nada e recebe o padrao ligado.
 */
function decidirLimparAoSair(raw, contaConectada = true) {
  if (raw == null) return contaConectada;
  try {
    const v = JSON.parse(raw)?.limparAoSair;
    if (v === false) return false;
    if (v === true) return true;
    return contaConectada;
  } catch (_) {
    return contaConectada;
  }
}

/**
 * Alguma conta de forja esta conectada neste cofre? Nunca lanca: o encerramento
 * nao pode travar numa leitura de cofre, e sem resposta a decisao segura e a
 * de nao apagar o que nao se sabe se e nosso.
 */
function contaConectada() {
  try {
    if (githubAuth.getToken()) return true;
  } catch (_) { /* cofre ilegivel: trate como ausente */ }
  try {
    if (gitlabAuth && typeof gitlabAuth.getToken === 'function' && gitlabAuth.getToken()) return true;
  } catch (_) { /* idem */ }
  return false;
}

/** O conteudo bruto do arquivo da preferencia, ou null quando nao ha arquivo. */
function lerPreferenciaBruta() {
  try {
    return fs.readFileSync(caminhoPreferencia(), 'utf8');
  } catch (e) {
    // ENOENT e o caso normal (instalacao nova, ninguem mexeu). Qualquer outro
    // erro e anomalia e merece registro, mas nao muda a decisao.
    if (e && e.code !== 'ENOENT') {
      log.warn('[github-forget] preferencia ilegivel, usando o padrao:', e);
    }
    return null;
  }
}

/** A preferencia como o interruptor das Configuracoes a mostra: padrao ligado. */
function limparAoSair() {
  return decidirLimparAoSair(lerPreferenciaBruta());
}

function definirLimparAoSair(ligado) {
  try {
    fs.writeFileSync(caminhoPreferencia(), JSON.stringify({ limparAoSair: !!ligado }, null, 2));
    return true;
  } catch (e) {
    log.warn('[github-forget] nao consegui gravar a preferencia:', e);
    return false;
  }
}

/**
 * Chamado no encerramento. Nao faz nada se a preferencia estiver desligada, nem
 * quando, no padrao, nenhuma conta foi conectada nesta instalacao: ai a unica
 * credencial de forja na maquina e de outro programa, e nao e nossa para apagar.
 * A conta e conferida ANTES da limpeza, porque o primeiro passo dela e
 * justamente esvaziar o cofre.
 */
async function aoEncerrar() {
  const conectada = contaConectada();
  if (!decidirLimparAoSair(lerPreferenciaBruta(), conectada)) {
    if (!conectada) log.info('[github-forget] nada a limpar ao sair: nenhuma conta de forja conectada nesta instalacao');
    return { ok: true, pulado: true };
  }
  log.info('[github-forget] limpando ao sair, conforme a preferencia');
  return esquecerTudo();
}

function register() {
  ipcMain.handle('github:forget-everything', () => esquecerTudo());
  ipcMain.handle('github:forget-scope', () => identidadeQueFica());
  ipcMain.handle('github:forget-on-exit-get', () => limparAoSair());
  ipcMain.handle('github:forget-on-exit-set', (_e, ligado) => definirLimparAoSair(ligado));
}

module.exports = {
  register, alvoEhDeForja, HOSTS, HOSTS_GITLAB,
  limparAoSair, decidirLimparAoSair, aoEncerrar,
};
