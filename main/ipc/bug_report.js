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
 * O RECORTE DO LOG
 * ----------------
 * Vão as últimas linhas, não o arquivo inteiro. Um `main.log` de sessão longa
 * passa de um megabyte, e o que interessa a um relato é o que aconteceu perto
 * da falha. Além disso, quanto menor o recorte, menor a chance de carregar
 * junto um caminho de projeto ou nome de arquivo que o usuário não pretendia
 * mandar.
 *
 * O QUE NÃO É COLETADO
 * --------------------
 * Nada de conteúdo de arquivo do usuário, nada de credencial, nada de conversa
 * com a IA, nada de identificador de máquina. O relato leva o que descreve o
 * ambiente e o que a própria pessoa escreveu.
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
        if (statusCode >= 200 && statusCode < 300) {
          let json = null;
          try { json = JSON.parse(txt); } catch (_) { /* resposta sem corpo */ }
          resolve({ ok: true, url: json?.url || null });
        } else {
          resolve({ ok: false, erro: `HTTP ${statusCode}`, detalhe: txt.slice(0, 300) });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, erro: 'tempo esgotado' }); });
    req.on('error', (e) => resolve({ ok: false, erro: e.message }));
    req.end(dados);
  });
}

/**
 * Corta o log ate a carga caber no limite.
 *
 * Corta em vez de recusar o envio: um relato sem as ultimas linhas ainda vale,
 * um relato recusado nao vale nada. Fica de fora do `enviar` porque e a unica
 * parte com laco, e um laco que encolhe a propria condicao de parada e o tipo
 * de coisa que trava calada em producao.
 *
 * Sempre termina: cada volta descarta metade do log, e a volta para quando
 * sobra pouco log, mesmo que o resto da carga por si so ja passe do limite.
 *
 * @param {{diagnostico: {log: string}}} carga mutada no lugar.
 */
function encolherParaCaber(carga) {
  let bytes = Buffer.byteLength(JSON.stringify(carga), 'utf8');
  while (bytes > LIMITE_BYTES && carga.diagnostico.log.length > 500) {
    carga.diagnostico.log = carga.diagnostico.log.slice(Math.floor(carga.diagnostico.log.length / 2));
    bytes = Buffer.byteLength(JSON.stringify(carga), 'utf8');
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
