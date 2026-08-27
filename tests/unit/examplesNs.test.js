/**
 * Os projetos de exemplo alcançáveis pela Aurora Intelligence.
 *
 * O que precisa de prova aqui é o contrato entre as duas pontas, porque ele é
 * amarrado por convenção e não por tipo: o manifesto diz `['examples','list']`
 * e o despachante procura essa função no objeto congelado. Errando o nome de
 * um dos lados, a ferramenta falha em runtime, na cara do aluno, e nada acusa
 * antes.
 *
 * A segunda coisa que se prova é o desenho de `install`: ela não recebe
 * caminho. O modelo não escolhe onde cinco projetos nascem no disco de
 * ninguém; quem escolhe é a pessoa, no seletor do sistema.
 *
 * O lado da API é conferido pelo TEXTO do arquivo, e não importando-o.
 * Importar `aurora_api.js` arrasta o Monaco, as abas e os componentes web, que
 * é o mesmo motivo de o teste do núcleo da API não importar.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { TOOL_MANIFEST } = require('../../main/ai/tools.js');

const FONTE = readFileSync(new URL('../../js/api/aurora_api.js', import.meta.url), 'utf8');

/** O corpo do namespace, entre a declaração dele e a do seguinte. */
const BLOCO = FONTE.slice(
  FONTE.indexOf('const examplesNs = {'),
  FONTE.indexOf('const settingsNs = {'),
);

const FERRAMENTAS = ['list_example_projects', 'install_example_projects'];
const buscar = (nome) => TOOL_MANIFEST.find((t) => t.name === nome);

describe('as ferramentas estão no manifesto', () => {
  it('as duas existem, com o acesso certo', () => {
    const listar = buscar('list_example_projects');
    const instalar = buscar('install_example_projects');

    expect(listar, 'list_example_projects').toBeTruthy();
    expect(instalar, 'install_example_projects').toBeTruthy();

    // Ler o catálogo não mexe em nada e não deve pedir confirmação; criar cinco
    // projetos no disco mexe, e tem que pedir.
    expect(listar.access).toBe('read');
    expect(instalar.access).toBe('write');
  });

  it('apontam para o namespace examples', () => {
    for (const nome of FERRAMENTAS) {
      expect(buscar(nome).api[0], nome).toBe('examples');
    }
  });

  it('nenhuma das duas aceita argumento', () => {
    // `install` sem caminho é o ponto do desenho: o destino sai do seletor do
    // sistema. Um esquema com propriedades aqui seria a porta para o modelo
    // escolher onde escrever.
    for (const nome of FERRAMENTAS) {
      const t = buscar(nome);
      expect(t.argStyle, nome).toBe('none');
      expect(Object.keys(t.inputSchema.properties || {}), nome).toEqual([]);
    }
  });

  it('a descrição de install avisa que cancelar não é erro', () => {
    // Sem isso o modelo trata a desistência do usuário como falha e tenta de
    // novo, abrindo o seletor na cara de quem acabou de fechá-lo.
    expect(buscar('install_example_projects').description).toMatch(/cancel/i);
  });

  it('a de listar promete o que o catálogo entrega', () => {
    const d = buscar('list_example_projects').description;
    expect(d).toMatch(/processor/i);
    expect(d).toMatch(/teach|study/i);
  });
});

describe('o namespace existe do lado da API', () => {
  it('está registrado como `examples` no objeto congelado', () => {
    // Renomear a chave aqui e esquecer o tools.js faz as duas ferramentas
    // apontarem para o vazio, e isso só apareceria em runtime.
    expect(FONTE).toContain('examples: Object.freeze(examplesNs)');
  });

  it('declara as duas funções que o manifesto procura', () => {
    expect(BLOCO.length).toBeGreaterThan(0);
    expect(BLOCO).toContain('async list()');
    expect(BLOCO).toContain('async install()');
  });

  it('install não recebe caminho, nem por engano', () => {
    // Assinatura vazia: o destino vem do seletor do sistema, no processo
    // principal, e nunca de um argumento que o modelo preencha.
    expect(BLOCO).toMatch(/async install\(\)\s*\{/);
  });

  it('usa os canais do preload, e não uma rota paralela', () => {
    // O mesmo caminho do botão da tela inicial. Uma segunda rota até o disco
    // seria um segundo lugar para esquecer o registro nos recentes.
    expect(BLOCO).toContain('exemplosListar');
    expect(BLOCO).toContain('exemplosInstalar');
  });

  it('devolve o caminho do .spf de cada projeto criado', () => {
    // É esse campo que o open_project consome em seguida; sem ele a IA instala
    // e não consegue abrir o que acabou de criar.
    expect(BLOCO).toContain('created: r.criados');
  });

  it('aparece na lista de namespaces que a IA consulta', () => {
    expect(FONTE).toContain("    list:    'The five ready-made example projects");
  });
});
