#!/usr/bin/env node
/**
 * gen-ai-tools-doc.mts: gera docs/aurora-intelligence-tools.md a partir do
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
 *   node scripts/gen-ai-tools-doc.mts
 *   node scripts/gen-ai-tools-doc.mts --check   # falha se o arquivo estiver desatualizado
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** O que o documento le de cada ferramenta do manifesto. */
export interface Ferramenta {
  name: string;
  description?: string;
  access?: string;
  api?: unknown;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'aurora-intelligence-tools.md');

/** Nomes de exibicao por namespace, na ordem em que aparecem no documento. */
const NAMESPACES: Record<string, string> = {
  project: 'Projeto',
  editor: 'Editor',
  compile: 'Compilacao e simulacao',
  wave: 'Formas de onda',
  prism: 'Simulacao interativa do PRISM',
  terminal: 'Terminais',
  settings: 'Configuracoes',
  rules: 'Regras da linguagem',
  git: 'Git',
  memory: 'Memoria de projeto',
};

function grupo(tool: Ferramenta): string {
  const ns = Array.isArray(tool.api) ? tool.api[0] : null;
  return ns && NAMESPACES[ns] ? ns : 'misc';
}

function params(tool: Ferramenta): string {
  const props = tool.inputSchema && tool.inputSchema.properties;
  if (!props || !Object.keys(props).length) return 'nenhum';
  const req = new Set((tool.inputSchema!.required) || []);
  return Object.keys(props)
    .map((p) => (req.has(p) ? `\`${p}\`` : `\`${p}\`?`))
    .join(', ');
}

/**
 * A descricao pronta para uma celula da tabela. A barra vertical fecharia a
 * celula, e a barra invertida antes dela desfaria o escape: as duas escapam,
 * a invertida primeiro (#276).
 */
export function celula(texto: unknown): string {
  return String(texto || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/** O documento inteiro, como texto, para o manifesto dado. */
export function gerarDocumento(manifesto: readonly Ferramenta[]): string {
  const porGrupo = new Map<string, Ferramenta[]>();
  for (const t of manifesto) {
    const g = grupo(t);
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g)!.push(t);
  }

  const linhas: string[] = [];
  linhas.push('# Ferramentas da Aurora Intelligence');
  linhas.push('');
  linhas.push('<!-- GERADO por scripts/gen-ai-tools-doc.mts. Nao edite a mao: a proxima');
  linhas.push('     execucao sobrescreve. Para mudar o texto de uma ferramenta, edite a');
  linhas.push('     `description` dela em main/ai/tools.ts, que e o mesmo texto que o');
  linhas.push('     modelo le ao decidir se a chama. -->');
  linhas.push('');
  linhas.push(`A AURORA expoe ${manifesto.length} ferramentas ao modelo. Elas chegam ate ele por dois`);
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
      const desc = celula(t.description);
      linhas.push(`| \`${t.name}\` | ${t.access || '-'} | ${params(t)} | ${desc} |`);
    }
    linhas.push('');
  }

  return linhas.join('\n');
}

/* v8 ignore start */ // a cola da linha de comando: le o manifesto compilado e grava ou confere
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { TOOL_MANIFEST } = createRequire(import.meta.url)('../main/ai/tools.js') as { TOOL_MANIFEST: Ferramenta[] };
  const novo = gerarDocumento(TOOL_MANIFEST);
  const grupos = new Set(TOOL_MANIFEST.map(grupo)).size;

  if (process.argv.includes('--check')) {
    const atual = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (atual !== novo) {
      console.error('  FALHA: docs/aurora-intelligence-tools.md esta desatualizado.');
      console.error('  Rode: node scripts/gen-ai-tools-doc.mts');
      process.exit(1);
    }
    console.log(`  OK  documento em dia com as ${TOOL_MANIFEST.length} ferramentas`);
    process.exit(0);
  }

  fs.writeFileSync(OUT, novo);
  console.log(`  OK  ${TOOL_MANIFEST.length} ferramentas em ${grupos} grupos escritas em docs/aurora-intelligence-tools.md`);
}
/* v8 ignore stop */
