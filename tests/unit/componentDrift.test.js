import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate, COMPONENTS } = require('../../scripts/check-component-drift.js');

// O decisor do guarda de deriva (scripts/check-component-drift.js). A rede fica
// de fora de proposito: o que precisa de teste e a leitura da lista publicada,
// porque um erro ali nao aparece como falha, aparece como silencio, que foi
// exatamente como o Surfer ficou cinco versoes atras sem ninguem ver.
//
// A lista chega SEMPRE da mais nova para a mais velha (e assim que a API de
// releases do GitHub e a de pacotes do GitLab devolvem), e a posicao da tag
// fixada dentro dela e a resposta inteira.

const familiaNips = /-nips\.\d+$/;

/** Encurta os casos: so a tag importa na maioria deles. */
const pub = (...tags) => tags.map((tag) => ({ tag, date: '2026-07-24' }));

describe('evaluate — o caso que motivou o guarda', () => {
  it('acha as cinco versoes que o Surfer estava atras', () => {
    const r = evaluate({
      pinned: 'v0.7.0-nips.2',
      family: familiaNips,
      published: pub(
        'v0.7.0-nips.7', 'v0.7.0-nips.6', 'v0.7.0-nips.5',
        'v0.7.0-nips.4', 'v0.7.0-nips.3', 'v0.7.0-nips.2', 'v0.7.0-nips.1',
      ),
    });
    expect(r.status).toBe('behind');
    expect(r.behind).toBe(5);
    expect(r.latest).toBe('v0.7.0-nips.7');
  });

  it('fica em dia depois do bump', () => {
    const r = evaluate({
      pinned: 'v0.7.0-nips.7',
      family: familiaNips,
      published: pub('v0.7.0-nips.7', 'v0.7.0-nips.6'),
    });
    expect(r.status).toBe('ok');
    expect(r.behind).toBe(0);
  });
});

describe('evaluate — familia', () => {
  it('ignora as tags do upstream que convivem no mesmo fork', () => {
    // Sem o filtro, a `v0.8.0` do surfer-project apareceria como se a nossa
    // `nips.7` estivesse atras, e o alarme seria falso toda vez que o upstream
    // publicasse.
    const r = evaluate({
      pinned: 'v0.7.0-nips.7',
      family: familiaNips,
      published: pub('v0.8.0', 'v0.7.0-nips.7', 'v0.7.0'),
    });
    expect(r.status).toBe('ok');
    expect(r.latest).toBe('v0.7.0-nips.7');
  });

  it('separa as duas linhagens do aurora-toolchain', () => {
    // O repositorio publica `msys-*` (o bundle) e `pins-*` (os pacotes MSYS2
    // fixados). Sao artefatos diferentes e nao se comparam.
    const familiaMsys = /^msys-/;
    const publicado = pub('pins-v2', 'msys-v1', 'pins-v1');
    expect(evaluate({ pinned: 'msys-v1', family: familiaMsys, published: publicado }).status).toBe('ok');
  });

  it('grita quando a propria tag fixada nao casa com a familia declarada', () => {
    // Isso e bug de configuracao do guarda, e precisa ser distinguivel de
    // deriva: tratar como deriva mandaria alguem subir uma versao que ja esta
    // certa, e o erro real continuaria escondido.
    const r = evaluate({
      pinned: 'v0.7.0',
      family: familiaNips,
      published: pub('v0.7.0-nips.7'),
    });
    expect(r.status).toBe('bad-family');
    expect(r.latest).toBeNull();
  });
});

describe('evaluate — os casos que nao sao deriva', () => {
  it('marca como sumida a tag fixada que nao esta mais publicada', () => {
    // Mais grave que estar atras: o bootstrap falha em maquina limpa, porque o
    // download aponta para um artefato que nao existe.
    const r = evaluate({
      pinned: 'v0.7.0-nips.3',
      family: familiaNips,
      published: pub('v0.7.0-nips.7', 'v0.7.0-nips.6'),
    });
    expect(r.status).toBe('absent');
    expect(r.latest).toBe('v0.7.0-nips.7');
    expect(r.behind).toBe(0);
  });

  it('nao inventa veredito quando o upstream nao devolveu nada da familia', () => {
    expect(evaluate({ pinned: 'v0.7.0-nips.7', family: familiaNips, published: [] }).status).toBe('unknown');
    expect(evaluate({ pinned: 'v0.7.0-nips.7', family: familiaNips, published: pub('v0.8.0') }).status).toBe('unknown');
  });

  it('sobrevive a entradas quebradas no meio da lista', () => {
    // Uma release sem tag_name (rascunho mal formado, resposta truncada) nao
    // pode derrubar a checagem inteira.
    const r = evaluate({
      pinned: 'v0.7.0-nips.6',
      family: familiaNips,
      published: [null, { tag: 'v0.7.0-nips.7' }, { date: '2026-07-01' }, { tag: 'v0.7.0-nips.6' }],
    });
    expect(r.status).toBe('behind');
    expect(r.behind).toBe(1);
  });

  it('trata tag fixada vazia como configuracao invalida, nao como em dia', () => {
    expect(evaluate({ pinned: '', family: familiaNips, published: pub('v0.7.0-nips.7') }).status).toBe('bad-family');
  });
});

describe('a tabela de componentes', () => {
  it('declara familia que casa com a tag que o proprio download-*.js fixa', () => {
    // Este e o teste que impede o guarda de apodrecer: se alguem trocar o
    // formato de uma tag e esquecer a familia, o check passaria a reportar
    // 'bad-family' toda semana e ninguem ligaria o motivo.
    for (const comp of COMPONENTS) {
      const mod = require(`../../components/Scripts/${comp.script}`);
      const pinned = comp.tagOf(mod);
      if (!pinned) continue; // componente desligado (ex.: fork ainda sem artefato)
      expect(comp.family.test(pinned), `${comp.key}: '${pinned}' nao casa com ${comp.family}`).toBe(true);
    }
  });

  it('cobre os quatro componentes de autoria do laboratorio', () => {
    const nossos = COMPONENTS.filter((c) => c.ours).map((c) => c.key).sort();
    expect(nossos).toEqual(['gtkwave', 'surfer', 'toolchain', 'yanc']);
  });

  it('nao repete chave nem script', () => {
    expect(new Set(COMPONENTS.map((c) => c.key)).size).toBe(COMPONENTS.length);
    expect(new Set(COMPONENTS.map((c) => c.script)).size).toBe(COMPONENTS.length);
  });
});
