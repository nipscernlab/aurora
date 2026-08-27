#!/usr/bin/env node
/**
 * gen-ai-tools-doc.js: gera docs/aurora-intelligence-tools.md a partir do
 * TOOL_MANIFEST em main/ai/tools.js.
 *
 * Por que gerar em vez de escrever. O documento escrito a mao ficou com 49
 * ferramentas enquanto o codigo tinha 103, e as 37 que faltavam incluiam
 * funcionalidades inteiras, como a memoria de projeto (remember/forget/
 * list_memories). Uma referencia que descreve dois tercos da superficie e pior
 * que nenhuma, porque quem le confia nela.
 *
 * A consequencia de desenho: a descricao de uma ferramenta mora no manifesto,
 * junto do codigo, que e tambem o texto que o MODELO le ao decidir se chama
 * aquela ferramenta. Uma explicacao boa serve aos dois leitores de uma vez, e
 * nao existe lugar onde ela possa divergir.
 *
 *   node scripts/gen-ai-tools-doc.js
 *   node scripts/gen-ai-tools-doc.js --check   # falha se o arquivo estiver desatualizado
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { TOOL_MANIFEST } = require('../main/ai/tools.js');

const OUT = path.join(__dirname, '..', 'docs', 'aurora-intelligence-tools.md');
const CHECK_ONLY = process.argv.includes('--check');

/** Nomes de exibicao por namespace, na ordem em que aparecem no documento. */
const NAMESPACES = {
  project: 'Projeto',
  editor: 'Editor',
  compile: 'Compilacao e simulacao',
  wave: 'Formas de onda',
  terminal: 'Terminais',
  settings: 'Configuracoes',
  rules: 'Regras da linguagem',
  git: 'Git',
  memory: 'Memoria de projeto',
};

function grupo(tool) {
  const ns = Array.isArray(tool.api) ? tool.api[0] : null;
  return ns && NAMESPACES[ns] ? ns : 'misc';
}

function params(tool) {
  const props = tool.inputSchema && tool.inputSchema.properties;
  if (!props || !Object.keys(props).length) return 'nenhum';
  const req = new Set((tool.inputSchema.required) || []);
  return Object.keys(props)
    .map((p) => (req.has(p) ? `\`${p}\`` : `\`${p}\`?`))
    .join(', ');
}

const porGrupo = new Map();
for (const t of TOOL_MANIFEST) {
  const g = grupo(t);
  if (!porGrupo.has(g)) porGrupo.set(g, []);
  porGrupo.get(g).push(t);
}

const linhas = [];
linhas.push('# Ferramentas da Aurora Intelligence');
linhas.push('');
linhas.push('<!-- GERADO por scripts/gen-ai-tools-doc.js. Nao edite a mao: a proxima');
linhas.push('     execucao sobrescreve. Para mudar o texto de uma ferramenta, edite a');
linhas.push('     `description` dela em main/ai/tools.js, que e o mesmo texto que o');
linhas.push('     modelo le ao decidir se a chama. -->');
linhas.push('');
linhas.push(`A AURORA expoe ${TOOL_MANIFEST.length} ferramentas ao modelo. Elas chegam ate ele por dois`);
linhas.push('caminhos, descritos abaixo.');
linhas.push('');
linhas.push('Pelo caminho de API, o `main/ai/chat.js` liga este manifesto direto no Vercel');
linhas.push('AI SDK. Pelo caminho de assinatura, as CLIs do Claude Code e do Codex so');
linhas.push('conhecem as proprias ferramentas embutidas, entao o `aurora_mcp_server.js`');
linhas.push('serve este mesmo manifesto por um servidor MCP local. Sem essa ponte o modelo');
linhas.push('cairia para o shell, chamando os compiladores na mao.');
linhas.push('');
linhas.push('A coluna de acesso separa o que so le do que escreve. Ferramentas de escrita');
linhas.push('passam pelo cartao de permissao do painel, conforme o modo configurado.');
linhas.push('');

const ordem = [...Object.keys(NAMESPACES), 'misc'];
for (const g of ordem) {
  const tools = porGrupo.get(g);
  if (!tools || !tools.length) continue;
  const titulo = NAMESPACES[g] || 'Diversos';
  linhas.push(`## ${titulo}`);
  linhas.push('');
  linhas.push('| Ferramenta | Acesso | Parametros | O que faz |');
  linhas.push('|---|---|---|---|');
  for (const t of tools.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const desc = String(t.description || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    linhas.push(`| \`${t.name}\` | ${t.access || '-'} | ${params(t)} | ${desc} |`);
  }
  linhas.push('');
}

const novo = linhas.join('\n');

if (CHECK_ONLY) {
  const atual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (atual !== novo) {
    console.error('  FALHA: docs/aurora-intelligence-tools.md esta desatualizado.');
    console.error('  Rode: node scripts/gen-ai-tools-doc.js');
    process.exit(1);
  }
  console.log(`  OK  documento em dia com as ${TOOL_MANIFEST.length} ferramentas`);
  process.exit(0);
}

fs.writeFileSync(OUT, novo);
console.log(`  OK  ${TOOL_MANIFEST.length} ferramentas em ${porGrupo.size} grupos escritas em docs/aurora-intelligence-tools.md`);
