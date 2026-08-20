// @ts-check
/**
 * bug_report.js: reúne o diagnóstico e envia o relato.
 *
 * O QUE ESTE MÓDULO PODE LER
 * --------------------------
 * Só o que está listado em `coletarDiagnostico`, e nada além. A lista é curta
 * de propósito e é a mesma que a interface mostra ao usuário antes de enviar:
 * se o painel diz que vai o fim do log, é o fim do log que vai, e o usuário
 * consegue conferir na tela o que está mandando.
 *
 * OS DOIS LOGS, E POR QUE SÃO DOIS
 * --------------------------------
 * O `main.log` fala do aplicativo; o recorte do terminal fala da compilação.
 * Quase todo relato vai ser sobre uma compilação que falhou, e a resposta está
 * no segundo, não no primeiro. Nenhum dos dois vai inteiro: do `main.log` vão
 * as últimas linhas, e do terminal vão os erros com a vizinhança deles
 * (js/terminal/terminal_excerpt.js). Além de caber no envio, recorte menor é
 * menos chance de carregar junto um caminho que o usuário não pretendia
 * mandar.
 *
 * O QUE NÃO É COLETADO
 * --------------------
 * Nada de conteúdo de arquivo do usuário, nada de credencial, nada de conversa
 * com a IA, nada de nome de máquina ou de conta. O nome de usuário que aparece
 * nos caminhos é removido antes do envio (`anonimizar`). O relato leva o que
 * descreve o ambiente, o que aconteceu na compilação, e o que a própria pessoa
 * escreveu.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { app, ipcMain } = require('electron');
const log = require('electron-log');

/** Quantas linhas do fim do log acompanham o relato. */
const LINHAS_DE_LOG = 200;

/** Teto do corpo enviado, para o Worker não receber um megabyte. */
const LIMITE_BYTES = 60 * 1024;

/**
 * Endereço do Worker que abre a issue.
 *
 * O token e o repositório de destino vivem no Worker, e não aqui: um endpoint
 * embutido no aplicativo é público por definição, e o que protege é o Worker
 * limitar tamanho e frequência, nunca o cliente ser secreto. A variável de
 * ambiente existe para apontar um Worker de teste sem gerar build.
 */
// Com www: o apex responde 301 para www, e um POST que precisa de redirect e
// um POST que pode se perder. O apex continua funcionando pelo seguidor de
// redirects do postar(), mas o padrao vai direto ao destino.
const ENDPOINT_PADRAO = 'https://www.nipscern.com/api/sapho/bugreport';

function endpoint() {
  const v = process.env.AURORA_BUGREPORT_URL;
  // String vazia desliga o envio direto de proposito, e deixa so o e-mail.
  if (v !== undefined) return v;
  return ENDPOINT_PADRAO;
}

/**
 * Remove o que identifica a pessoa dos caminhos que aparecem no log.
 *
 * O log carrega caminhos como C:\Users\fulano\Documents\..., e o nome da conta
 * do Windows costuma ser o nome da pessoa. Minimizar aqui vale mais do que
 * avisar depois: o dado que não sai da máquina é o único que dispensa
 * proteção (LGPD, art. 6º III — coletar só o necessário). O nome vira o
 * marcador <usuario>, que preserva a estrutura do caminho para depuração.
 *
 * Não é perfeito, e o consentimento diz isso: um caminho de projeto com nome
 * próprio ("C:\...\tcc-do-joao") ainda passa, porque não há como saber o que é
 * nome de gente no meio de nomes de pasta.
 */
function anonimizar(texto) {
  let saida = String(texto || '');
  const candidatos = new Set();
  try { candidatos.add(path.basename(os.homedir())); } catch (_) { /* segue */ }
  try { candidatos.add(os.userInfo().username); } catch (_) { /* pode falhar em conta restrita */ }
  for (const nome of candidatos) {
    if (!nome || nome.length < 2) continue;
    // Escapa o nome para uso literal em regex (pontos, hifens etc.).
    const literal = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    saida = saida.replace(new RegExp(literal, 'gi'), '<usuario>');
  }
  return saida;
}

/** As últimas linhas do log, ou uma explicação de por que não vieram. */
function caudaDoLog() {
  try {
    const p = path.join(app.getPath('userData'), 'logs', 'main.log');
    if (!fs.existsSync(p)) return '(sem arquivo de log)';
    const bruto = fs.readFileSync(p, 'utf8');
    const linhas = bruto.split(/\r?\n/);
    return anonimizar(linhas.slice(-LINHAS_DE_LOG).join('\n').trim()) || '(log vazio)';
  } catch (e) {
    return `(nao foi possivel ler o log: ${e instanceof Error ? e.message : e})`;
  }
}

/**
 * Espaço livre onde os componentes moram.
 *
 * Explica sozinho uma classe inteira de relatos: extração que falha no fim,
 * build que morre sem mensagem clara. Uma linha, e nada dela identifica quem
 * quer que seja.
 */
function espacoLivreGB() {
  try {
    const { componentsPath } = require('../paths');
    // statfsSync existe no Node 18+; se faltar, o relato segue sem o numero.
    if (typeof fs.statfsSync !== 'function') return null;
    const s = fs.statfsSync(componentsPath);
    return Math.round((s.bavail * s.bsize) / 1073741824);
  } catch (_) { return null; }
}

/**
 * Quais componentes esta máquina tem.
 *
 * "Não compila" com a cadeia ausente é o relato mais provável agora que ela é
 * baixada depois, e esta linha responde a pergunta antes de alguém precisar
 * perguntar.
 */
function componentesInstalados() {
  try {
    const registro = require('../components/registry');
    return registro.listar()
      .map((c) => `${c.chave}${c.instalado ? '' : ' (ausente)'}`)
      .join(', ');
  } catch (_) { return ''; }
}

/**
 * Tudo que acompanha o relato, além do que a pessoa escreveu.
 *
 * Devolvido também para a interface poder MOSTRAR antes de enviar. Coletar e
 * exibir pela mesma função é o que garante que a tela não minta sobre o envio.
 */
function coletarDiagnostico() {
  return {
    versao: app.getVersion(),
    sistema: `${os.platform()} ${os.release()} ${os.arch()}`,
    memoriaGB: Math.round(os.totalmem() / 1073741824),
    nucleos: os.cpus()?.length || 0,
    discoLivreGB: espacoLivreGB(),
    componentes: componentesInstalados(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    empacotado: app.isPackaged,
    log: caudaDoLog(),
  };
}

/**
 * POST em JSON, sem dependência nova.
 *
 * Segue redirects (até 3) re-enviando o corpo. O https.request não segue
 * nenhum, e foi assim que o primeiro envio real morreu: o apex do site
 * responde 301 para www, o POST parava ali e o usuário via "HTTP 301" sem
 * ter feito nada de errado.
 */
function postar(url, corpo, saltos = 0) {
  return new Promise((resolve) => {
    let alvo;
    try { alvo = new URL(url); } catch (_) {
      resolve({ ok: false, erro: 'endereco invalido' }); return;
    }
    const dados = Buffer.from(JSON.stringify(corpo), 'utf8');
    const req = https.request({
      hostname: alvo.hostname,
      path: alvo.pathname + alvo.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': dados.length },
      timeout: 20000,
    }, (res) => {
      const { statusCode } = res;
      if ([301, 302, 307, 308].includes(statusCode) && res.headers.location) {
        res.resume();
        if (saltos >= 3) { resolve({ ok: false, erro: 'redirects demais' }); return; }
        const destino = new URL(res.headers.location, alvo).toString();
        resolve(postar(destino, corpo, saltos + 1));
        return;
      }
      let txt = '';
      res.on('data', (c) => { txt += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(txt); } catch (_) { /* resposta sem corpo */ }
        if (statusCode >= 200 && statusCode < 300) {
          resolve({ ok: true, url: json?.url || null });
          return;
        }
        // Limite de frequencia nao e falha: e "ainda nao". Sobe com codigo
        // proprio e com o prazo, porque "aguarde" sem prazo faz a pessoa
        // clicar de novo em seguida e ser barrada de novo.
        if (statusCode === 429) {
          const doCorpo = Number(json?.esperar);
          const doCabecalho = Number(res.headers['retry-after']);
          const esperar = [doCorpo, doCabecalho].find((n) => Number.isFinite(n) && n > 0) || 300;
          resolve({ ok: false, erro: 'muitos-relatos', esperar });
          return;
        }
        resolve({ ok: false, erro: `HTTP ${statusCode}`, detalhe: txt.slice(0, 300) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, erro: 'tempo esgotado' }); });
    req.on('error', (e) => resolve({ ok: false, erro: e.message }));
    req.end(dados);
  });
}

/** O tamanho da carga, em bytes, como ela vai pela rede. */
function tamanhoDa(carga) {
  return Buffer.byteLength(JSON.stringify(carga), 'utf8');
}

/**
 * Corta o log ate a carga caber no limite.
 *
 * Corta em vez de recusar o envio: um relato sem as ultimas linhas ainda vale,
 * um relato recusado nao vale nada.
 *
 * A ORDEM DO SACRIFICIO
 * ---------------------
 * Nem todo campo vale o mesmo. O `main.log` fala do aplicativo e e o primeiro
 * a encolher; o recorte do terminal fala da compilacao que falhou, que e o
 * assunto do relato, e so cede depois. O que a pessoa escreveu nunca e
 * tocado: e a unica parte que ninguem consegue recuperar depois.
 *
 * O corte guarda o FIM de cada um, porque e onde a falha aparece.
 *
 * @param {{diagnostico: {log: string}, terminal?: string}} carga mutada no lugar.
 */
function encolherParaCaber(carga) {
  // Do menos precioso para o mais precioso.
  const campos = [
    { ler: () => carga.diagnostico.log, gravar: (v) => { carga.diagnostico.log = v; }, piso: 500 },
    { ler: () => carga.terminal || '', gravar: (v) => { carga.terminal = v; }, piso: 1000 },
  ];

  for (const campo of campos) {
    // Corta pela metade ate caber, ou ate chegar ao piso deste campo; so
    // entao passa para o proximo. O laco sempre termina porque o valor
    // encolhe a cada volta e o piso e o fundo.
    while (tamanhoDa(carga) > LIMITE_BYTES && campo.ler().length > campo.piso) {
      const atual = campo.ler();
      campo.gravar(atual.slice(Math.floor(atual.length / 2)));
    }
    if (tamanhoDa(carga) <= LIMITE_BYTES) return carga;
  }
  return carga;
}

/**
 * O e-mail de contato, se houver e se tiver cara de e-mail.
 *
 * Validacao de forma, nao de existencia: o campo e opcional e um endereco
 * digitado errado so custa a resposta, nunca o relato. Um valor sem @ e
 * descartado em silencio pelo mesmo motivo.
 */
function emailDeContato(valor) {
  const v = String(valor || '').trim().slice(0, 120);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

/**
 * Envia o relato.
 *
 * @param {{oQueAconteceu: string, oQueEsperava?: string, comoReproduzir?: string, email?: string}} texto
 */
async function enviar(texto = {}) {
  const oQue = String(texto.oQueAconteceu || '').trim();
  // Sem descricao nao ha relato. Barrar aqui, e nao so na interface, porque
  // este caminho tambem e alcancavel por IPC.
  if (!oQue) return { ok: false, erro: 'sem-descricao' };

  const url = endpoint();
  if (!url) return { ok: false, erro: 'sem-endpoint' };

  const diag = coletarDiagnostico();
  const carga = {
    titulo: oQue.split('\n')[0].slice(0, 120),
    oQueAconteceu: oQue.slice(0, 8000),
    oQueEsperava: String(texto.oQueEsperava || '').trim().slice(0, 4000),
    comoReproduzir: String(texto.comoReproduzir || '').trim().slice(0, 4000),
    // Opcional, e dado pelo proprio usuario: o consentimento diz que ele so
    // serve para responder sobre este relato.
    email: emailDeContato(texto.email),
    // O recorte vem do renderer, que e quem tem o terminal. Passa pelo mesmo
    // anonimizar do log: caminho de compilacao carrega o nome da conta igual.
    terminal: anonimizar(String(texto.terminal || '')).slice(0, 40000),
    diagnostico: diag,
  };

  encolherParaCaber(carga);

  const r = await postar(url, carga);
  if (r.ok) log.info('[bug-report] relato enviado');
  else log.warn('[bug-report] falhou:', r.erro);
  return r;
}

function register() {
  ipcMain.handle('bugreport:diagnostico', () => coletarDiagnostico());
  ipcMain.handle('bugreport:enviar', (_e, texto) => enviar(texto));
  ipcMain.handle('bugreport:disponivel', () => !!endpoint());
}

module.exports = {
  register, coletarDiagnostico, enviar, encolherParaCaber, endpoint, anonimizar,
  emailDeContato,
  LINHAS_DE_LOG, LIMITE_BYTES,
};
