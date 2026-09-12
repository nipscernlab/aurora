// @ts-check
/**
 * feed-local.js: um canal de atualizacao falso, servido do disco, para testar
 * o fluxo de update de ponta a ponta sem publicar nada para a turma.
 *
 * Por que isto existe. O card de atualizacao e desenhado pela versao que esta
 * RODANDO. Entao para ver uma mudanca nele (o botao de minimizar, por
 * exemplo) nao basta publicar a versao que tem a mudanca: e preciso INSTALAR
 * essa versao e oferecer a ela uma versao ainda mais nova. Sem isto, seriam
 * duas releases de verdade so para olhar um botao.
 *
 * Como funciona. Pega o instalador que o electron-builder acabou de gerar,
 * copia com um numero de versao maior, escreve o `latest.yml` que o
 * electron-updater le (versao, tamanho e sha512 do arquivo) e serve a pasta
 * por HTTP em 127.0.0.1. O aplicativo instalado, iniciado com
 * `AURORA_UPDATE_FEED` apontando para ca, encontra a versao nova, baixa de
 * verdade e mostra o card de verdade.
 *
 * O instalador servido e o MESMO que voce instalou, so com outro nome: quem
 * aceitar "reiniciar agora" reinstala a mesma coisa. Isso e de proposito,
 * porque o que se testa aqui e o card, nao o conteudo da atualizacao.
 *
 * Uso:
 *   node scripts/feed-local.js                  usa o .exe mais novo de release/
 *   node scripts/feed-local.js --exe <caminho>  usa um especifico
 *   node scripts/feed-local.js --versao 9.9.9   o numero que o feed anuncia
 *   node scripts/feed-local.js --porta 842
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const PASTA_FEED = path.join(REPO, 'release', 'feed-local');

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

/** O instalador mais recente em release/, ou null. */
function instaladorMaisNovo() {
  const dir = path.join(REPO, 'release');
  if (!fs.existsSync(dir)) return null;
  const exes = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return exes.length ? path.join(dir, exes[0].f) : null;
}

function sha512De(arquivo) {
  const h = crypto.createHash('sha512');
  h.update(fs.readFileSync(arquivo));
  return h.digest('base64');
}

function main() {
  const versao = arg('--versao', '99.0.0');
  const porta = Number(arg('--porta', '8399'));
  const origem = arg('--exe', instaladorMaisNovo());

  if (!origem || !fs.existsSync(origem)) {
    console.error('Nao achei instalador. Gere um com `npm run build` ou passe --exe <caminho>.');
    process.exit(1);
  }

  fs.mkdirSync(PASTA_FEED, { recursive: true });
  const nome = `sapho-aurora-Setup-v${versao}.exe`;
  const destino = path.join(PASTA_FEED, nome);

  // Copia so quando precisa: o arquivo tem centenas de megabytes.
  const precisa = !fs.existsSync(destino)
    || fs.statSync(destino).size !== fs.statSync(origem).size;
  if (precisa) {
    process.stdout.write(`copiando ${path.basename(origem)} como ${nome} ... `);
    fs.copyFileSync(origem, destino);
    console.log('ok');
  }

  // O `.blockmap` ao lado, quando existir. O electron-updater o procura para
  // baixar so o que mudou; sem ele a tentativa falha e o download recomeca
  // inteiro, o que funciona mas polui o log com um erro que nao e erro.
  const blockmapOrigem = `${origem}.blockmap`;
  if (fs.existsSync(blockmapOrigem)) {
    fs.copyFileSync(blockmapOrigem, `${destino}.blockmap`);
  }

  const sha512 = sha512De(destino);
  const size = fs.statSync(destino).size;
  const yml = [
    `version: ${versao}`,
    'files:',
    `  - url: ${nome}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${nome}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(PASTA_FEED, 'latest.yml'), yml, 'utf8');

  const servidor = http.createServer((req, res) => {
    const pedido = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '');
    // Sem subir de pasta: serve so o que esta em PASTA_FEED.
    const alvo = path.join(PASTA_FEED, path.basename(pedido));
    if (!pedido || !fs.existsSync(alvo)) {
      res.writeHead(404); res.end('nao achei'); return;
    }
    console.log(`  -> ${pedido}`);
    res.writeHead(200, {
      'Content-Type': pedido.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
      'Content-Length': fs.statSync(alvo).size,
    });
    fs.createReadStream(alvo).pipe(res);
  });

  servidor.listen(porta, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${porta}`;
    console.log('');
    console.log(`Feed local de pe em ${url}`);
    console.log(`  anunciando a versao ${versao} (${(size / 1048576).toFixed(1)} MB)`);
    console.log('');
    console.log('Agora, num outro terminal, abra a AURORA JA INSTALADA apontando para ca:');
    console.log('');
    console.log(`  $env:AURORA_UPDATE_FEED = "${url}"`);
    console.log('  & "$env:LOCALAPPDATA\\Programs\\sapho\\SAPHO.exe"');
    console.log('');
    console.log('Na AURORA: o botao de atualizacao na barra de status acende sozinho em');
    console.log('alguns segundos. Clique nele, depois em Baixar, e o card de atualizacao');
    console.log('aparece: e ali que esta o botao de minimizar.');
    console.log('');
    console.log('Ctrl+C encerra o feed.');
  });
}

main();
