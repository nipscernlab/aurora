#!/usr/bin/env node
// @ts-check
/**
 * gen-pylib-icons.js — monta assets/icons/pylibs.svg, a folha de simbolos do
 * painel de bibliotecas.
 *
 * DE ONDE VEM CADA ICONE
 * ----------------------
 * Onde a biblioteca TEM marca propria, usamos a marca de verdade, buscada do
 * Simple Icons (https://simpleicons.org), que distribui os arquivos em CC0 e
 * entrega tudo no mesmo formato: viewBox 24x24, um unico <path>, monocromatico.
 * Isso importa porque um logo colorido de 7 camadas nao le a 32px e nao segue o
 * tema da AURORA; o path unico segue o `currentColor` e funciona nos dois temas.
 *
 * A maior parte das bibliotecas, porem, simplesmente NAO tem logo — vcdvcd,
 * pyvcd, fixedpoint, intelhex, crc, tabulate e companhia sao projetos pequenos,
 * sem identidade visual. Para elas nao inventamos uma marca falsa: entra um
 * simbolo neutro que descreve a CATEGORIA (forma de onda, tabela, memoria,
 * grafo). E o que a propria PyPI faz, e e honesto — o usuario ve de imediato
 * que aquilo nao e o logo do projeto.
 *
 * O uso das marcas registradas aqui e nominativo: identificar cada projeto numa
 * lista de instalacao, exatamente como qualquer gerenciador de pacotes faz.
 *
 * USO
 *   node scripts/gen-pylib-icons.js           # rebaixa e regrava o sprite
 *   node scripts/gen-pylib-icons.js --check   # falha se o sprite mudou
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'assets', 'icons', 'pylibs.svg');
// Indice dos simbolos que existem no sprite. O painel le este arquivo para
// saber quando cair no generico: o catalogo e remoto e pode citar um icone que
// esta versao da AURORA ainda nao tem, e um <use> apontando para um simbolo
// inexistente nao desenha NADA — fica um buraco na linha, sem erro nenhum.
const INDEX_OUT = path.join(__dirname, '..', 'assets', 'icons', 'pylibs.json');
const CDN = (slug) => `https://cdn.jsdelivr.net/npm/simple-icons@15/icons/${slug}.svg`;

/**
 * id no catalogo -> slug no Simple Icons. So entram as bibliotecas que de fato
 * possuem marca registrada publicada.
 */
const BRANDS = {
  python: 'python',
  numpy: 'numpy',
  scipy: 'scipy',
  pandas: 'pandas',
  plotly: 'plotly',
  pytest: 'pytest',
  sympy: 'sympy',
  tqdm: 'tqdm',
  rich: 'rich',
};

/**
 * Simbolos neutros de categoria, para as bibliotecas sem marca propria.
 * Desenhados com traco de 2px numa grade 32x32, para casarem opticamente com os
 * icones Phosphor que o resto da toolbar usa.
 */
const NEUTRAL = {
  // Onda digital — vcdvcd, pyvcd.
  vcd: `<path d="M3 21 L8 21 L8 11 L14 11 L14 21 L20 21 L20 11 L26 11 L26 21 L29 21"
        fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
        stroke-linejoin="round"/>`,

  // Corrotina abracando o dado — familia cocotb.
  cocotb: `<path d="M23 8.5a10 10 0 1 0 2.6 9" fill="none" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round"/>
           <circle cx="16" cy="16" r="3.6" fill="currentColor"/>
           <circle cx="25.2" cy="7.4" r="2.4" fill="currentColor" opacity=".6"/>`,

  // Camadas do ambiente de verificacao — pyuvm.
  pyuvm: `<path d="M16 3 L28 9 L16 15 L4 9 Z" fill="currentColor" opacity=".85"/>
          <path d="M4 15.5 L16 21.5 L28 15.5" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linejoin="round" opacity=".55"/>
          <path d="M4 22 L16 28 L28 22" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linejoin="round" opacity=".3"/>`,

  // Grafico de barras vetorial — pygal.
  pygal: `<rect x="5" y="17" width="5" height="10" rx="1" fill="currentColor" opacity=".5"/>
          <rect x="13.5" y="10" width="5" height="17" rx="1" fill="currentColor" opacity=".8"/>
          <rect x="22" y="14" width="5" height="13" rx="1" fill="currentColor" opacity=".5"/>
          <path d="M3 29h26" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".4"/>`,

  // Grafico dentro do terminal — plotext.
  plotext: `<rect x="3" y="5" width="26" height="22" rx="3" fill="none" stroke="currentColor"
            stroke-width="2" opacity=".55"/>
            <path d="M7 21 L12 14 L17 18 L25 10" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="7" cy="21" r="1.4" fill="currentColor"/>
            <circle cx="25" cy="10" r="1.4" fill="currentColor"/>`,

  // Bezier — drawsvg.
  drawsvg: `<path d="M5 24 C10 6 22 6 27 24" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round"/>
            <rect x="2.5" y="21.5" width="5" height="5" rx="1" fill="currentColor"/>
            <rect x="24.5" y="21.5" width="5" height="5" rx="1" fill="currentColor"/>
            <circle cx="16" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/>`,

  // Digitos que continuam — mpmath (precisao arbitraria).
  mpmath: `<circle cx="6.5" cy="22" r="2.2" fill="currentColor"/>
           <path d="M11.5 22h3.5M17.5 22h3M23 22h2.5M27.5 22h1.5" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round" opacity=".75"/>
           <path d="M4 10h8M15 10h4M22 10h4" stroke="currentColor" stroke-width="2.4"
           stroke-linecap="round" opacity=".4"/>
           <path d="M4 16h10M17 16h5M25 16h4" stroke="currentColor" stroke-width="2.4"
           stroke-linecap="round" opacity=".55"/>`,

  // Virgula binaria fixa — fixedpoint.
  fixedpoint: `<path d="M3 13h9M3 19h9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
               <circle cx="16" cy="19" r="2.2" fill="currentColor"/>
               <path d="M20 13h9M20 19h9" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" opacity=".55"/>
               <path d="M16 5v3M16 24v3" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" opacity=".35"/>`,

  // Mais-menos — uncertainties.
  uncertainties: `<path d="M16 6v14M9 13h14" stroke="currentColor" stroke-width="2.6"
                  stroke-linecap="round"/>
                  <path d="M9 25h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,

  // Celulas de memoria — intelhex.
  intelhex: `<rect x="4" y="7" width="24" height="18" rx="2.5" fill="none" stroke="currentColor"
             stroke-width="2" opacity=".6"/>
             <path d="M4 13h24M4 19h24M12 7v18M20 7v18" stroke="currentColor"
             stroke-width="1.4" opacity=".45"/>
             <rect x="12" y="13" width="8" height="6" fill="currentColor" opacity=".55"/>`,

  // Blocos encaixados — construct.
  construct: `<rect x="4" y="5" width="11" height="9" rx="1.5" fill="currentColor" opacity=".8"/>
              <rect x="17" y="5" width="11" height="9" rx="1.5" fill="none" stroke="currentColor"
              stroke-width="2" opacity=".55"/>
              <rect x="4" y="18" width="24" height="9" rx="1.5" fill="none" stroke="currentColor"
              stroke-width="2" opacity=".55"/>`,

  // Polinomio realimentado — crc.
  crc: `<path d="M6 20a10 10 0 1 1 3 5" fill="none" stroke="currentColor" stroke-width="2.4"
        stroke-linecap="round"/>
        <path d="M4 17.5 L6.5 21 L10 19" fill="none" stroke="currentColor" stroke-width="2.4"
        stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13 16h6M13 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        opacity=".5"/>`,

  // Conector serial — pyserial.
  pyserial: `<rect x="5" y="11" width="22" height="12" rx="3" fill="none" stroke="currentColor"
             stroke-width="2" opacity=".65"/>
             <circle cx="11" cy="17" r="1.7" fill="currentColor"/>
             <circle cx="16" cy="17" r="1.7" fill="currentColor"/>
             <circle cx="21" cy="17" r="1.7" fill="currentColor"/>
             <path d="M16 5v6M16 23v4" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" opacity=".45"/>`,

  // Grafo — networkx (o logo oficial e colorido, de sete camadas, e nao le a 32px).
  networkx: `<circle cx="16" cy="6" r="3" fill="currentColor"/>
             <circle cx="6" cy="22" r="3" fill="currentColor" opacity=".7"/>
             <circle cx="26" cy="22" r="3" fill="currentColor" opacity=".7"/>
             <circle cx="16" cy="17" r="2.6" fill="currentColor" opacity=".85"/>
             <path d="M16 9v5M14 19 L8.5 21M18 19 L23.5 21M9 22h14" fill="none"
             stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>`,

  // Grade — tabulate.
  tabulate: `<rect x="4" y="6" width="24" height="20" rx="2.5" fill="none" stroke="currentColor"
             stroke-width="2" opacity=".6"/>
             <path d="M4 12.5h24M4 19.5h24M12 6v20M20 6v20" stroke="currentColor"
             stroke-width="1.5" opacity=".45"/>
             <path d="M4 8.5a2.5 2.5 0 0 1 2.5-2.5h19a2.5 2.5 0 0 1 2.5 2.5v4H4Z"
             fill="currentColor" opacity=".25"/>`,

  // Numero virando texto — humanize.
  humanize: `<path d="M5 11h7M8.5 11v11" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round"/>
             <path d="M16 16.5h3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
             opacity=".45"/>
             <path d="M23 10.5c2.5 0 4 1.4 4 3.2 0 2.6-4 3-4 5.8M23 24.5v.2"
             fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,

  // Grafico estatico — matplotlib (o logo oficial e um wordmark de 900x216).
  matplotlib: `<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor"
               stroke-width="1.6" opacity=".5"/>
               <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor"
               stroke-width="1.6" opacity=".3"/>
               <path d="M16 4v24M4 16h24M7.5 7.5l17 17M24.5 7.5l-17 17" stroke="currentColor"
               stroke-width="1" opacity=".28"/>
               <path d="M16 16 L26 12 A11 11 0 0 0 21 6 Z" fill="currentColor" opacity=".8"/>`,

  // Pacote generico — id de icone desconhecido cai aqui.
  generic: `<path d="M16 3 L28 9.5 L28 22.5 L16 29 L4 22.5 L4 9.5 Z" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M4 9.5 L16 16 L28 9.5 M16 16 L16 29" fill="none" stroke="currentColor"
            stroke-width="1.6" opacity=".5"/>`,
};

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('redirecionamentos demais')); return; }
    https.get(url, { headers: { 'User-Agent': 'aurora-ide' } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
        res.resume();
        resolve(get(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} em ${url}`)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Extrai o `d` do path unico de um icone do Simple Icons. */
function extractPath(svg, slug) {
  const m = svg.match(/<path\s+d="([^"]+)"/);
  if (!m) throw new Error(`nao achei o path em ${slug}`);
  return m[1];
}

async function main() {
  const check = process.argv.includes('--check');
  const symbols = [];

  for (const [id, slug] of Object.entries(BRANDS)) {
    const svg = await get(CDN(slug));
    const d = extractPath(svg, slug);
    symbols.push(
      `    <!-- ${slug}: marca oficial, Simple Icons (CC0). -->\n`
      + `    <symbol id="pylib-${id}" viewBox="0 0 24 24">\n`
      + `      <path fill="currentColor" d="${d}"/>\n`
      + '    </symbol>',
    );
    process.stdout.write(`[icones] ${id} <- simple-icons/${slug}\n`);
  }

  for (const [id, body] of Object.entries(NEUTRAL)) {
    const clean = body.trim().split('\n').map((l) => `      ${l.trim()}`).join('\n');
    symbols.push(
      `    <!-- ${id}: simbolo de categoria (o projeto nao publica marca propria). -->\n`
      + `    <symbol id="pylib-${id}" viewBox="0 0 32 32">\n${clean}\n    </symbol>`,
    );
    process.stdout.write(`[icones] ${id} <- simbolo neutro\n`);
  }

  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Bibliotecas Python">
  <!--
    GERADO POR scripts/gen-pylib-icons.js — NAO EDITE A MAO.

    Folha de simbolos do painel de bibliotecas. Referenciada por
    <use href="./assets/icons/pylibs.svg#pylib-<id>">; a cor vem do CSS via
    currentColor, entao o mesmo arquivo serve aos temas claro e escuro.

    Os simbolos de marca sao os icones oficiais do Simple Icons
    (https://simpleicons.org), distribuidos em CC0 1.0. As marcas continuam de
    seus donos; o uso aqui e nominativo, para identificar cada projeto na lista
    de instalacao. As bibliotecas sem marca propria recebem um simbolo neutro de
    categoria, nao um logo inventado.
  -->
  <defs>
${symbols.join('\n')}
  </defs>

  <!-- Vista padrao ao abrir o arquivo direto: a marca do Python. -->
  <use href="#pylib-python" width="24" height="24"/>
</svg>
`;

  const ids = [...Object.keys(BRANDS), ...Object.keys(NEUTRAL)];
  const index = `${JSON.stringify({ ids }, null, 2)}
`;

  if (check) {
    const curIndex = fs.existsSync(INDEX_OUT) ? fs.readFileSync(INDEX_OUT, 'utf8') : '';
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== out || curIndex !== index) {
      process.stderr.write('[icones] sprite desatualizado — rode: node scripts/gen-pylib-icons.js\n');
      process.exit(1);
    }
    process.stdout.write('[icones] em dia.\n');
    return;
  }

  fs.writeFileSync(OUT, out);
  fs.writeFileSync(INDEX_OUT, index);
  process.stdout.write(`\n[icones] ${symbols.length} simbolos -> ${path.relative(process.cwd(), OUT)}\n`);
  process.stdout.write(`[icones] indice -> ${path.relative(process.cwd(), INDEX_OUT)}\n`);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`[icones] ERRO: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

module.exports = { BRANDS, NEUTRAL, extractPath };
