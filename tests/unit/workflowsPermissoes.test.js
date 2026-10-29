/**
 * Todo workflow declara, no topo, o que o token do GitHub pode fazer.
 *
 * Sem o bloco, o workflow herda o padrao da organizacao, que hoje e leitura
 * mas pode mudar sem que nada no repositorio mude junto. As diretrizes da
 * organizacao (secao 9) pedem o minimo escrito no arquivo; a #276 achou tres
 * workflows sem ele. Este teste reprova o workflow novo que esquecer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const PASTA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows');
const workflows = fs.readdirSync(PASTA)
  .filter((n) => /\.ya?ml$/.test(n))
  .map((n) => [n, parse(fs.readFileSync(path.join(PASTA, n), 'utf8'))]);

describe('permissoes dos workflows', () => {
  it('acha os workflows', () => {
    expect(workflows.map(([n]) => n)).toEqual(expect.arrayContaining(['ci.yml', 'codeql.yml', 'release.yml']));
  });

  it.each(workflows)('%s declara as permissoes no topo, sem write-all', (_nome, wf) => {
    expect(wf.permissions).toBeTypeOf('object');
    expect(wf.permissions).not.toBeNull();
    for (const valor of Object.values(wf.permissions)) expect(['read', 'write', 'none']).toContain(valor);
  });

  it('o CI, o CodeQL e o release so leem no topo', () => {
    for (const nome of ['ci.yml', 'codeql.yml', 'release.yml']) {
      const [, wf] = workflows.find(([n]) => n === nome);
      expect(wf.permissions).toEqual({ contents: 'read' });
    }
  });
});
