// @ts-check
/**
 * components.js: instalar e remover componentes durante o uso da AURORA.
 *
 * QUEM BAIXA É O MESMO SCRIPT DE SEMPRE
 * -------------------------------------
 * Os `components/Scripts/download-*.js` já existiam e já são o que monta a
 * máquina de desenvolvimento e o instalador. Reescrever a lógica de download
 * aqui criaria duas verdades sobre qual versão de cada componente é a certa, e
 * as duas divergiriam no primeiro bump que alguém fizesse num lado só. Então
 * este módulo não baixa nada: ele executa aquele script.
 *
 * COMO ELE EXECUTA
 * ----------------
 * Num processo filho, com o próprio Electron rodando em modo Node. Não há Node
 * instalado na máquina do usuário, e não pode haver: o SAPHO é um instalador só.
 * `ELECTRON_RUN_AS_NODE` faz o executável que já está aqui se comportar como
 * Node puro, que é exatamente o que esses scripts esperam.
 *
 * Em processo filho, e não aqui dentro, por dois motivos. Um download de
 * novecentos megabytes com extração no fim seguraria o processo principal, e
 * com ele a janela inteira. E um script que falhe derruba o filho, não a
 * AURORA.
 *
 * O PROGRESSO
 * -----------
 * Os scripts já escrevem "[surfer] 42% (18.1 / 43.0 MB)" na saída. Em vez de
 * inventar um protocolo, lemos o que eles já dizem. Quando a linha não casa, o
 * texto vai como está para o painel: uma linha de log verdadeira informa mais
 * do que uma barra parada.
 *
 * A REMOÇÃO
 * ---------
 * Só do que não é essencial, e por caminho montado aqui a partir do catálogo,
 * nunca por caminho vindo do renderer. Apagar diretório é a operação em que um
 * caminho recebido de fora custa mais caro.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ipcMain, BrowserWindow, shell } = require('electron');
const log = require('electron-log');

const registro = require('../components/registry');
const ia = require('../components/ia');
const { componentsPath } = require('../paths');
// Pelo registro, e nao pelo spawn puro: o filho fica visivel ao encerramento.
// Antes, fechar a AURORA no meio do download do MSYS deixava um Node baixando
// e extraindo dentro de components/ sem janela nenhuma, que e justamente o
// que faz uma instalacao seguinte terminar pela metade. E o reap do arranque
// nao o alcancava, porque casa por prefixo de caminho e o executavel deste
// filho e o da instalacao, nao o de components/. Grupo SERVICE: o Cancelar
// da compilacao nao tem nada a ver com um download.
const { spawnTracked, GROUP } = require('../process_registry');

/** Um download por vez. Dois puxando ao mesmo tempo só disputam a mesma banda. */
let emAndamento = null;

/** A pasta dos instaladores, ao lado dos componentes. */
function pastaDosScripts() {
  return path.join(componentsPath, 'Scripts');
}

/** Manda uma linha de progresso para a janela que pediu. */
function avisar(janela, carga) {
  try {
    if (janela && !janela.isDestroyed()) janela.webContents.send('componentes:progresso', carga);
  } catch (_) { /* a janela pode ter fechado no meio do download */ }
}

/** "[surfer] 42% (18.1 / 43.0 MB)" -> 42 */
function lerPercentual(linha) {
  const m = /(\d{1,3})%/.exec(linha);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * Executa o instalador de um componente.
 *
 * @param {string} chave
 * @param {import('electron').BrowserWindow|null} janela
 */
function instalar(chave, janela, forcar = false) {
  if (emAndamento) return Promise.resolve({ ok: false, erro: 'ja-ha-download', chave: emAndamento });
  // Os agentes de IA nao passam por script: quem baixa e o cli_downloader, em
  // processo, e a versao nova substitui a antiga sozinha (forcar nao se aplica).
  if (ia.conhece(chave)) return instalarIA(chave, janela);
  const comp = registro.obter(chave);
  if (!comp) return Promise.resolve({ ok: false, erro: 'componente desconhecido' });

  const script = path.join(pastaDosScripts(), comp.script);
  if (!fs.existsSync(script)) {
    return Promise.resolve({ ok: false, erro: `instalador ausente: ${comp.script}` });
  }

  emAndamento = chave;
  avisar(janela, { chave, estado: 'iniciando', percentual: 0, linha: `Baixando ${comp.nome}` });

  return new Promise((resolve) => {
    // --force: o doctor re-baixa componente INCOMPLETO, cuja sentinela existe;
    // sem a flag o script veria a sentinela e sairia dizendo que esta tudo la.
    const argumentos = forcar ? [script, '--force'] : [script];
    const filho = spawnTracked(process.execPath, argumentos, {
      cwd: path.dirname(componentsPath),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        // A extracao (components/Scripts/lib/extract.js) descompacta muitas
        // entradas ao mesmo tempo no pool de threads do Node, que tem 4 fios
        // por padrao. Dimensionar pelo numero de nucleos e o que faz os
        // dezessete mil arquivos da cadeia de compilacao usarem a maquina
        // inteira em vez de um fio so.
        UV_THREADPOOL_SIZE: String(Math.min(16, Math.max(4, os.cpus().length))),
      },
      windowsHide: true,
    }, GROUP.SERVICE);

    let ultimaLinha = '';
    const digerir = (buf) => {
      // O progresso vem com \r, sem \n, para reescrever a mesma linha no
      // terminal. Separar pelos dois e o que faz cada atualizacao chegar.
      for (const parte of String(buf).split(/[\r\n]+/)) {
        const linha = parte.trim();
        if (!linha) continue;
        ultimaLinha = linha;
        avisar(janela, { chave, estado: 'baixando', percentual: lerPercentual(linha), linha });
      }
    };
    filho.stdout.on('data', digerir);
    filho.stderr.on('data', digerir);

    filho.on('error', (e) => {
      emAndamento = null;
      log.warn(`[componentes] ${chave} nao executou:`, e);
      avisar(janela, { chave, estado: 'erro', linha: e.message });
      resolve({ ok: false, erro: e.message });
    });

    filho.on('close', (codigo) => {
      emAndamento = null;
      // A prova nao e o codigo de saida, e a sentinela. Um script pode sair
      // zero tendo baixado um arquivo truncado, e quem responde "esta
      // instalado?" para o resto da AURORA e o mesmo arquivo que o allowlist
      // consulta. Conferir aqui e conferir com o mesmo criterio.
      registro.invalidarCache(chave);
      const diagnostico = registro.diagnosticar(chave);
      const instalado = diagnostico.estado !== 'ausente';
      if (codigo === 0 && diagnostico.estado === 'ok') {
        log.info(`[componentes] ${chave} instalado`);
        avisar(janela, { chave, estado: 'pronto', percentual: 100, linha: `${comp.nome} instalado` });
        resolve({ ok: true, chave });
        return;
      }
      // A causa tecnica vai para o log; para o usuario vai o que ele pode
      // fazer. "Terminou sem deixar a sentinela" nao diz nada a um aluno; a
      // causa de longe mais comum e a conexao cair no meio do download.
      const detalheTecnico = !instalado
        ? `o instalador terminou sem deixar ${comp.sentinela}`
        : diagnostico.estado !== 'ok'
          ? `o instalador terminou com o componente ${diagnostico.estado}`
            + ` (faltando: ${diagnostico.faltando.join(', ') || '-'}; versao gravada: ${diagnostico.versaoInstalada || '-'})`
          : `o instalador saiu com codigo ${codigo}`;
      log.warn(`[componentes] ${chave} falhou: ${detalheTecnico} | ultima linha: ${ultimaLinha}`);
      const erro = 'o download não chegou ao fim. Confira a internet e clique em Baixar de novo';
      avisar(janela, { chave, estado: 'erro', linha: erro });
      resolve({ ok: false, erro, detalhe: `${detalheTecnico} | ${ultimaLinha}` });
    });
  });
}

/**
 * Baixa um agente de IA pelo mesmo canal de progresso dos outros componentes.
 *
 * @param {'claude'|'codex'} chave
 * @param {import('electron').BrowserWindow|null} janela
 */
async function instalarIA(chave, janela) {
  const nome = ia.obter(chave)?.nome || chave;
  emAndamento = chave;
  avisar(janela, { chave, estado: 'iniciando', percentual: 0, linha: `Baixando ${nome}` });
  try {
    await ia.instalar(chave, (linha, percentual) =>
      avisar(janela, { chave, estado: 'baixando', percentual, linha }));
    // A prova e o diagnostico, nao a promessa resolvida: o mesmo criterio dos
    // outros componentes.
    const d = ia.diagnosticar(chave);
    if (d.estado !== 'ok') throw new Error(`terminou com o componente ${d.estado}`);
    log.info(`[componentes] ${chave} instalado`);
    avisar(janela, { chave, estado: 'pronto', percentual: 100, linha: `${nome} instalado` });
    return { ok: true, chave };
  } catch (e) {
    const detalhe = e instanceof Error ? e.message : String(e);
    log.warn(`[componentes] ${chave} falhou: ${detalhe}`);
    const erro = 'o download não chegou ao fim. Confira a internet e clique em Baixar de novo';
    avisar(janela, { chave, estado: 'erro', linha: erro });
    return { ok: false, erro, detalhe };
  } finally {
    emAndamento = null;
  }
}

/**
 * Remove um componente, para recuperar espaço.
 *
 * O caminho apagado é o diretório do componente, derivado da sentinela do
 * catálogo. Nada vem do renderer além da chave.
 */
async function remover(chave) {
  if (ia.conhece(chave)) {
    if (emAndamento === chave) return { ok: false, erro: 'ja-ha-download', chave };
    const r = await ia.remover(chave);
    if (r.ok) log.info(`[componentes] ${chave} removido`);
    return r;
  }
  const comp = registro.obter(chave);
  if (!comp) return { ok: false, erro: 'componente desconhecido' };
  if (comp.essencial) return { ok: false, erro: 'componente essencial' };

  // A sentinela de todo componente removivel mora dentro da pasta dele, em
  // Packages/<nome>[/bin]. Apagamos a pasta do componente, que e o primeiro
  // nivel abaixo de Packages, e nunca acima disso.
  const partes = comp.sentinela.split('/');
  if (partes[0] !== 'Packages' || partes.length < 3) {
    return { ok: false, erro: 'caminho do componente fora do esperado' };
  }
  const alvo = path.join(componentsPath, 'Packages', partes[1]);

  // Cinto de seguranca: o alvo tem que estar mesmo debaixo de components.
  const dentro = path.resolve(alvo).startsWith(path.resolve(componentsPath) + path.sep);
  if (!dentro) return { ok: false, erro: 'caminho fora de components' };

  try {
    await fs.promises.rm(alvo, { recursive: true, force: true });
    registro.invalidarCache(chave);
    log.info(`[componentes] ${chave} removido`);
    return { ok: true, chave, liberadoMB: comp.tamanhoMB };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * O doctor conserta este componente, e forçando o download?
 *
 * Está aqui fora, como função de uma linha de raciocínio só, porque é a regra
 * inteira do doctor: tudo o mais naquele laço é limpeza de cache, log e
 * contagem. Errar aqui não quebra nada visivelmente, custa 272 MB de download
 * numa rede de laboratório, ou deixa um componente quebrado parecendo são.
 *
 * `forcar` acompanha a decisão em vez de ser escolhido por quem chama: o
 * `--force` é o que faz o instalador re-baixar apesar da sentinela, e ele é
 * necessário exatamente quando o componente ESTÁ lá e mesmo assim precisa ser
 * baixado de novo (incompleto ou de outra versão). Numa instalação ausente ele
 * não teria efeito nenhum, e mandá-lo assim mesmo confundiria a leitura do log.
 *
 * @param {{estado: string}} diagnostico
 * @param {{essencial?: boolean, requerParaCompilar?: boolean}|undefined} comp
 * @returns {{conserta: boolean, forcar: boolean}}
 */
function decidirConserto(diagnostico, comp) {
  const estado = diagnostico?.estado;
  // Instalado e defeituoso, ou instalado e de outra versão: conserta sempre,
  // mesmo sendo opcional. Opcional que a pessoa baixou é opcional que ela usa,
  // e o que ela usa tem que ser a versão que esta AURORA espera.
  if (estado === 'incompleto' || estado === 'desatualizado') {
    return { conserta: true, forcar: true };
  }
  // Ausente: só o que a AURORA precisa para funcionar. Ausência de componente
  // opcional é escolha do usuário, não defeito, e um doctor que baixa o que
  // ninguém pediu é um doctor que ninguém roda.
  if (estado === 'ausente' && (comp?.essencial || comp?.requerParaCompilar)) {
    return { conserta: true, forcar: false };
  }
  return { conserta: false, forcar: false };
}

/**
 * O doctor: verifica todos os componentes e conserta o que estiver quebrado.
 *
 * O QUE ELE FAZ, EM ORDEM
 * -----------------------
 * 1. Limpa o cache de compilação (components/Temp) e os zips parciais que um
 *    download interrompido deixou para trás.
 * 2. Diagnostica cada componente pelos arquivos-chave, não só pela sentinela:
 *    a sentinela diz que a instalação terminou, os arquivos-chave dizem se
 *    terminou inteira.
 * 3. Re-baixa com --force o que estiver INCOMPLETO ou DESATUALIZADO (carimbo
 *    de outra versão), e baixa o que estiver ausente sendo necessário para
 *    compilar.
 *
 * O QUE ELE NÃO FAZ, DE PROPÓSITO
 * -------------------------------
 * Não apaga tudo para baixar tudo. Numa máquina saudável isso seria trocar
 * dez segundos de verificação por uma hora de download em rede de
 * laboratório, e um doctor caro é um doctor que ninguém roda. Quem quiser a
 * reinstalação total de um componente saudável tem o caminho: remover e
 * baixar de novo pelo painel. E não baixa componente opcional que o usuário
 * nunca instalou: ausência escolhida não é defeito.
 *
 * @param {import('electron').BrowserWindow|null} janela
 */
async function doctor(janela) {
  if (emAndamento) return { ok: false, erro: 'ja-ha-download', chave: emAndamento };

  // Sem os instaladores nao ha conserto possivel: eles SAO a ferramenta de
  // reparo. E o unico estado que o doctor nao alcanca, e a resposta certa e
  // dizer isso de uma vez, nao falhar sete vezes com "instalador ausente".
  if (!fs.existsSync(pastaDosScripts())) {
    log.warn('[doctor] components/Scripts ausente; reinstalar e o unico caminho');
    return { ok: false, erro: 'sem-scripts' };
  }

  const resultado = {
    ok: true,
    cacheLimpo: false,
    saudaveis: /** @type {string[]} */ ([]),
    consertados: /** @type {string[]} */ ([]),
    falharam: /** @type {string[]} */ ([]),
    ausentesOpcionais: /** @type {string[]} */ ([]),
  };

  // 1. Caches. O components/Temp guarda artefatos de compilacao; zip parcial
  // e resto de download que morreu no meio.
  try {
    require('../temp_gc').clearTempFolderSync(componentsPath);
    for (const arquivo of fs.readdirSync(path.dirname(componentsPath))) {
      if (/^(aurora-|surfer-aurora).*\.zip$/i.test(arquivo)) {
        fs.rmSync(path.join(path.dirname(componentsPath), arquivo), { force: true });
      }
    }
    resultado.cacheLimpo = true;
  } catch (e) {
    log.warn('[doctor] limpeza de cache falhou:', e);
  }

  // 2 e 3. Diagnostico e conserto, um componente por vez: dois downloads
  // juntos so disputam a mesma banda.
  registro.invalidarCache();
  for (const d of registro.diagnosticarTudo()) {
    if (d.estado === 'ok') { resultado.saudaveis.push(d.chave); continue; }

    const veredito = decidirConserto(d, registro.obter(d.chave));
    if (!veredito.conserta) { resultado.ausentesOpcionais.push(d.chave); continue; }

    log.info(`[doctor] ${d.chave} ${d.estado}; faltando: ${d.faltando.join(', ') || '-'}; versao gravada: ${d.versaoInstalada || '-'}`);
    const r = await instalar(d.chave, janela, veredito.forcar);
    (r.ok ? resultado.consertados : resultado.falharam).push(d.chave);
  }

  // Os agentes de IA: so o que esta em OUTRA versao e consertado. Ausente e
  // escolha (a pessoa nunca usou), e ausente fica.
  for (const d of ia.diagnosticarTudo()) {
    if (d.estado === 'ok') { resultado.saudaveis.push(d.chave); continue; }
    if (d.estado !== 'desatualizado') { resultado.ausentesOpcionais.push(d.chave); continue; }
    log.info(`[doctor] ${d.chave} desatualizado; versao gravada: ${d.versaoInstalada || '-'}`);
    const r = await instalar(d.chave, janela);
    (r.ok ? resultado.consertados : resultado.falharam).push(d.chave);
  }

  resultado.ok = resultado.falharam.length === 0;
  return resultado;
}

/**
 * A janela esta sendo dirigida por um teste?
 *
 * Serve para uma coisa so: nao deixar o aviso de boot, que e um modal, nascer
 * por cima de quem esta clicando. Um modal nao pedido no boot rouba o ponteiro
 * da suite e2e inteira, e o runner nunca tem componentes baixados, entao o
 * aviso aparecia sempre e reprovava tudo.
 *
 * O marcador e o SAPHO_SKIP_SINGLE_INSTANCE que o proprio harness ja define em
 * todo teste e2e (tests/e2e/*.js). Reaproveita-lo evita a armadilha de um flag
 * novo que cada teste futuro teria que lembrar de setar, e cujo esquecimento
 * apareceria como falha intermitente e confusa. AURORA_SEM_AVISO_DE_BOOT fica
 * como desligamento explicito, para quem quiser o efeito sem mexer no lock.
 */
function sobAutomacao() {
  return process.env.SAPHO_SKIP_SINGLE_INSTANCE === '1'
    || process.env.AURORA_SEM_AVISO_DE_BOOT === '1';
}

function register() {
  ipcMain.handle('componentes:listar', () => ({
    componentes: [...registro.listar(), ...ia.listar()],
    baixando: emAndamento,
    pasta: componentsPath,
    avisoDeBootPermitido: !sobAutomacao(),
  }));

  // `forcar` vem do botao Atualizar: o instalador ve a sentinela de uma
  // versao antiga e so re-baixa com --force.
  ipcMain.handle('componentes:instalar', (evento, chave, opcoes) =>
    instalar(chave, BrowserWindow.fromWebContents(evento.sender), Boolean(opcoes && opcoes.forcar)));

  ipcMain.handle('componentes:remover', (_e, chave) => remover(chave));

  ipcMain.handle('componentes:doctor', (evento) =>
    doctor(BrowserWindow.fromWebContents(evento.sender)));

  // Usado pela interface para decidir se mostra o aviso num botao, e pelo
  // prompt da Aurora Intelligence. Le do disco, entao acompanha o que o
  // usuario acabou de baixar sem precisar reiniciar.
  ipcMain.handle('componentes:instalado', (_e, chave) => registro.estaInstalado(chave));

  ipcMain.handle('componentes:abrirPasta', () => {
    try { shell.openPath(componentsPath); return { ok: true }; }
    catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) }; }
  });
}

module.exports = {
  register, instalar, remover, doctor, decidirConserto, lerPercentual, sobAutomacao,
};
