/**
 * A referencia das ferramentas da IA (docs/aurora-intelligence-tools.md) sai
 * de scripts/gen-ai-tools-doc.mts. O CI confere com --check que o arquivo esta
 * em dia; aqui se prova que o gerador, chamado como funcao, escreve exatamente
 * o que esta no repositorio, e como cada celula da tabela e montada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { celula, gerarDocumento } from '../../scripts/gen-ai-tools-doc.mts';
import { TOOL_MANIFEST } from '../../main/ai/tools.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('gen-ai-tools-doc', () => {
  it('gera o mesmo documento que esta no repositorio', () => {
    const atual = fs.readFileSync(path.join(RAIZ, 'docs', 'aurora-intelligence-tools.md'), 'utf8');
    expect(gerarDocumento(TOOL_MANIFEST)).toBe(atual);
  });

  it('agrupa por namespace, ordena por nome e marca os parametros opcionais', () => {
    const doc = gerarDocumento([
      { name: 'zeta', api: ['git'], access: 'read', description: 'Z.' },
      { name: 'alfa', api: ['git'], description: 'A  com\n espaco.', inputSchema: { properties: { a: {}, b: {} }, required: ['a'] } },
      { name: 'solta', description: 'Sem namespace.' },
    ]);
    expect(doc).toContain('A AURORA expoe 3 ferramentas');
    const git = doc.indexOf('## Git');
    const misc = doc.indexOf('## Diversos');
    expect(git).toBeGreaterThan(0);
    expect(misc).toBeGreaterThan(git);
    expect(doc.indexOf('`alfa`')).toBeLessThan(doc.indexOf('`zeta`'));
    expect(doc).toContain('| `alfa` | - | `a`, `b`? | A com espaco. |');
    expect(doc).toContain('| `zeta` | read | nenhum | Z. |');
  });

  it('a barra vertical da descricao nao quebra a tabela', () => {
    const doc = gerarDocumento([{ name: 'x', api: ['git'], description: 'a | b' }]);
    expect(doc).toContain('| `x` | - | nenhum | a \\| b |');
  });

  it('a barra invertida escapa antes, para nao desfazer o escape da vertical (#276)', () => {
    expect(celula('a\\|b')).toBe('a\\\\\\|b');
    expect(celula('C:\\p')).toBe('C:\\\\p');
    expect(celula(undefined)).toBe('');
  });
});
