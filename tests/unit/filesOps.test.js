/**
 * Testes da parte pura do main/ipc/files.js.
 *
 * Este e o arquivo de IPC com a maior superficie e o que mais toca disco, e ate
 * 08/08/2026 nao tinha um teste sequer: tudo aqui vivia dentro de handlers de
 * `ipcMain`, num modulo que carrega `electron` no topo, entao nao havia como
 * alcancar nada sem subir o aplicativo.
 *
 * Dois blocos sao de seguranca e nao de comodidade. O `urlExternaPermitida`
 * decide o que vai para o `shell.openExternal`, com a URL podendo ter nascido
 * numa mensagem escrita pelo modelo de IA. E o `aspasPowerShell` monta a linha
 * de comando do backup a partir de um caminho que o usuario escolheu.
 */

import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  compararEntradas,
  planoDeRenomear,
  aspasPowerShell,
  comandoCompactar,
  nomesDoBackup,
  entraNoBackup,
  urlExternaPermitida,
  urlHomepagePermitida,
  comandoTerminalNativo,
  pastaInicialDoDialogo,
  acharWatcher,
  ausenciaEsperada,
} from '../../main/ipc/files_ops.js';

/** Entrada de diretorio no formato que o `readdir` com `withFileTypes` devolve. */
const entrada = (name, dir = false) => ({ name, isDirectory: () => dir });

describe('urlExternaPermitida', () => {
  it('deixa passar o que e web e o que e correio', () => {
    for (const boa of [
      'https://nipscern.com',
      'http://localhost:3000/docs',
      'HTTPS://NIPSCERN.COM',
      'mailto:luciano.andrade@ufjf.br',
    ]) expect(urlExternaPermitida(boa), boa).toBe(true);
  });

  it('NAO deixa passar file://, que abriria qualquer coisa do disco', () => {
    expect(urlExternaPermitida('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(urlExternaPermitida('file://servidor/compartilhado/x.exe')).toBe(false);
  });

  it('NAO deixa passar esquema que cai em handler registrado na maquina', () => {
    for (const ma of [
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'javascript:alert(1)',
      'vscode://file/C:/x',
      'data:text/html,<script>alert(1)</script>',
      'shell:startup',
    ]) expect(urlExternaPermitida(ma), ma).toBe(false);
  });

  it('nao se deixa enganar por esquema no meio da string', () => {
    // O ancora `^` e o que faz isto: sem ele, qualquer coisa contendo `http:`
    // em algum ponto passaria.
    expect(urlExternaPermitida('file:///x?u=https://ok.com')).toBe(false);
    expect(urlExternaPermitida(' https://com-espaco-antes.com')).toBe(false);
  });

  it('devolve falso para o que nao e string', () => {
    for (const v of [null, undefined, 42, {}, [], true]) {
      expect(urlExternaPermitida(v)).toBe(false);
    }
  });
});

describe('urlHomepagePermitida', () => {
  it('so https, porque a URL vem do catalogo de pacotes', () => {
    expect(urlHomepagePermitida('https://pypi.org/project/numpy/')).toBe(true);
    expect(urlHomepagePermitida('HTTPS://PYPI.ORG/')).toBe(true);
  });

  it('e mais estreita que a do open-external, e isso e deliberado', () => {
    // Estes tres passam la e nao passam aqui. O bloco existe para a diferenca
    // aparecer em teste, e nao so no comentario.
    for (const u of ['http://pypi.org/', 'mailto:x@y.com', 'http://localhost:8000/']) {
      expect(urlExternaPermitida(u), `${u} passa no open-external`).toBe(true);
      expect(urlHomepagePermitida(u), `${u} NAO passa na homepage`).toBe(false);
    }
  });

  it('barra file e esquema registrado, igual a outra', () => {
    for (const u of ['file:///C:/x.exe', 'javascript:alert(1)', 'ms-msdt:/id X']) {
      expect(urlHomepagePermitida(u), u).toBe(false);
    }
  });

  it('devolve falso para o que nao e string', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(urlHomepagePermitida(v)).toBe(false);
  });
});

describe('aspasPowerShell', () => {
  it('envolve em aspas simples', () => {
    expect(aspasPowerShell('C:\\Projetos\\contador')).toBe("'C:\\Projetos\\contador'");
  });

  it('duplica a aspa simples, que e como o PowerShell a escapa', () => {
    expect(aspasPowerShell("pasta d'agua")).toBe("'pasta d''agua'");
  });

  it('nao deixa a aspa fechar a string e emendar outro comando', () => {
    // A tentativa classica: fechar a aspa e emendar um `;`.
    const saida = aspasPowerShell("x'; Remove-Item -Recurse C:\\ #");
    expect(saida.startsWith("'")).toBe(true);
    expect(saida.endsWith("'")).toBe(true);
    // Toda aspa interna virou par, entao nenhuma delas fecha a string.
    const internas = saida.slice(1, -1);
    expect(internas.replace(/''/g, '')).not.toContain("'");
  });

  it('aguenta caminho com acento, que e o caso do laboratorio', () => {
    expect(aspasPowerShell('C:\\Usuários\\João\\Área de Trabalho'))
      .toBe("'C:\\Usuários\\João\\Área de Trabalho'");
  });

  it('nao quebra com o que nao e string', () => {
    expect(aspasPowerShell(42)).toBe("'42'");
    expect(aspasPowerShell(null)).toBe("'null'");
  });
});

describe('comandoCompactar', () => {
  it('compacta o CONTEUDO da pasta de preparo, e nao a pasta', () => {
    // O `\*` no fim e o que faz o zip abrir nos arquivos em vez de numa pasta
    // `backup_<carimbo>` que so existia para o preparo.
    const cmd = comandoCompactar('C:\\p\\backup_2026', 'C:\\p\\Backup\\p_2026.zip');
    expect(cmd).toContain(`${path.join('C:\\p\\backup_2026', '*')}`);
    expect(cmd).toContain('-DestinationPath');
    expect(cmd).toContain('-Force');
  });

  it('escapa os dois caminhos, nao so um', () => {
    const cmd = comandoCompactar("C:\\d'ir", "C:\\d'est.zip");
    expect(cmd).toContain("d''ir");
    expect(cmd).toContain("d''est.zip");
  });
});

describe('nomesDoBackup', () => {
  const n = nomesDoBackup('C:\\Projetos\\contador', '2026-08-08_18-30-00');

  it('o zip leva o nome da pasta e o carimbo', () => {
    expect(path.basename(n.zip)).toBe('contador_2026-08-08_18-30-00.zip');
  });

  it('o zip fica dentro de Backup, e o preparo fica fora', () => {
    expect(n.zip.startsWith(n.pastaBackup)).toBe(true);
    expect(n.pastaPreparo.startsWith(n.pastaBackup)).toBe(false);
  });

  it('a pasta de preparo e irma da Backup, dentro do projeto', () => {
    expect(path.dirname(n.pastaPreparo)).toBe('C:\\Projetos\\contador');
    expect(n.nomePreparo).toBe('backup_2026-08-08_18-30-00');
  });
});

describe('entraNoBackup', () => {
  it('deixa entrar arquivo comum', () => {
    expect(entraNoBackup('contador.v', 'backup_x')).toBe(true);
    expect(entraNoBackup('Hardware', 'backup_x')).toBe(true);
  });

  it('barra a Backup, senao cada backup carregaria os anteriores', () => {
    expect(entraNoBackup('Backup', 'backup_x')).toBe(false);
  });

  it('barra a propria pasta de preparo, senao a copia se copiaria', () => {
    expect(entraNoBackup('backup_x', 'backup_x')).toBe(false);
    // E a de OUTRO backup entra, porque nao e o destino desta copia.
    expect(entraNoBackup('backup_y', 'backup_x')).toBe(true);
  });
});

describe('planoDeRenomear', () => {
  it('renome comum vai direto, checando o destino', () => {
    const p = planoDeRenomear('C:\\p\\a.v', 'C:\\p\\b.v', false);
    expect(p).toEqual({ via: 'direto', checarDestino: true });
  });

  it('com overwrite ligado nao checa o destino', () => {
    const p = planoDeRenomear('C:\\p\\a.v', 'C:\\p\\b.v', true);
    expect(p).toEqual({ via: 'direto', checarDestino: false });
  });

  it('mudar so a caixa passa por nome temporario', () => {
    // No Windows os dois nomes sao a MESMA entrada para o `fs.stat`: sem o
    // desvio, a checagem de destino acusaria conflito com o proprio arquivo.
    const p = planoDeRenomear('C:\\p\\README.md', 'C:\\p\\readme.md', false);
    expect(p.via).toBe('temporario');
    expect(p.tmp).toBe('C:\\p\\README.md.__aurora_case_tmp__');
  });

  it('o desvio vale mesmo com overwrite ligado', () => {
    expect(planoDeRenomear('C:\\p\\A.v', 'C:\\p\\a.v', true).via).toBe('temporario');
  });

  it('caminho identico nao e mudanca de caixa, e vai direto', () => {
    expect(planoDeRenomear('C:\\p\\a.v', 'C:\\p\\a.v', false).via).toBe('direto');
  });

  it('mover para outra pasta com outra caixa nao e mudanca de caixa', () => {
    const p = planoDeRenomear('C:\\p\\a.v', 'C:\\q\\b.v', false);
    expect(p.via).toBe('direto');
  });
});

describe('compararEntradas', () => {
  it('pasta vem antes de arquivo', () => {
    expect(compararEntradas(entrada('z', true), entrada('a', false))).toBeLessThan(0);
    expect(compararEntradas(entrada('a', false), entrada('z', true))).toBeGreaterThan(0);
  });

  it('dentro do mesmo grupo, ordem alfabetica', () => {
    const arquivos = [entrada('c.v'), entrada('a.v'), entrada('b.v')];
    expect([...arquivos].sort(compararEntradas).map((e) => e.name))
      .toEqual(['a.v', 'b.v', 'c.v']);
  });

  it('ordena uma lista mista como a arvore mostra', () => {
    const itens = [
      entrada('main.v'), entrada('Hardware', true), entrada('a.cmm'),
      entrada('Software', true), entrada('Backup', true),
    ];
    expect([...itens].sort(compararEntradas).map((e) => e.name))
      .toEqual(['Backup', 'Hardware', 'Software', 'a.cmm', 'main.v']);
  });

  it('acento nao vai parar no fim da lista', () => {
    // `localeCompare`, e nao comparacao de codigo: com `<` o `Á` cairia depois
    // do `Z`, o que no laboratorio e o caso comum.
    const itens = [entrada('Zebra'), entrada('Área'), entrada('Banco')];
    expect([...itens].sort(compararEntradas).map((e) => e.name))
      .toEqual(['Área', 'Banco', 'Zebra']);
  });
});

describe('comandoTerminalNativo', () => {
  it('no Windows abre um console NOVO, com titulo vazio', () => {
    const c = comandoTerminalNativo('win32', 'C:\\Projetos\\meu projeto');
    expect(c.comando).toBe('cmd.exe');
    // O `""` e o titulo: sem ele o `start` engole o proximo argumento como
    // titulo da janela.
    expect(c.args).toEqual(['/c', 'start', '""', 'cmd.exe']);
    // O caminho vai pelo cwd do spawn, nao pelo argumento: e o que faz pasta
    // com espaco funcionar.
    expect(c.usaCwd).toBe(true);
    expect(c.args.join(' ')).not.toContain('meu projeto');
  });

  it('no macOS o caminho e argumento do open', () => {
    const c = comandoTerminalNativo('darwin', '/Users/x/proj');
    expect(c.comando).toBe('open');
    expect(c.args).toEqual(['-a', 'Terminal', '/Users/x/proj']);
    expect(c.usaCwd).toBe(false);
  });

  it('no resto respeita o TERMINAL do ambiente', () => {
    expect(comandoTerminalNativo('linux', '/x', 'alacritty').comando).toBe('alacritty');
    expect(comandoTerminalNativo('linux', '/x').comando).toBe('x-terminal-emulator');
    expect(comandoTerminalNativo('linux', '/x', '').comando).toBe('x-terminal-emulator');
  });
});

describe('pastaInicialDoDialogo', () => {
  it('usa o que o renderer mandou', () => {
    expect(pastaInicialDoDialogo({ defaultPath: 'D:\\Trabalhos' }, 'C:\\Docs'))
      .toBe('D:\\Trabalhos');
  });

  it('cai em Documentos quando nao veio nada utilizavel', () => {
    // Sem isto o Windows abre no ultimo diretorio do processo, que acaba sendo
    // o projeto aberto, e o usuario cria projeto dentro de projeto.
    for (const v of [{}, undefined, null, { defaultPath: '' }, { defaultPath: 42 }]) {
      expect(pastaInicialDoDialogo(v, 'C:\\Docs')).toBe('C:\\Docs');
    }
  });
});

describe('acharWatcher', () => {
  const watchers = new Map([
    ['C:\\p\\a.v', { id: 'watcher_1', filePath: 'C:\\p\\a.v' }],
    ['C:\\p\\b.v', { id: 'watcher_2', filePath: 'C:\\p\\b.v' }],
  ]);

  it('acha pelo id', () => {
    expect(acharWatcher(watchers, 'watcher_2').filePath).toBe('C:\\p\\b.v');
  });

  it('acha pelo caminho, porque o renderer guarda ora um ora outro', () => {
    expect(acharWatcher(watchers, 'C:\\p\\a.v').id).toBe('watcher_1');
  });

  it('devolve nulo quando nao existe, em vez de estourar', () => {
    expect(acharWatcher(watchers, 'watcher_9')).toBe(null);
    expect(acharWatcher(new Map(), 'qualquer')).toBe(null);
  });
});

describe('ausenciaEsperada', () => {
  it('ausencia e ENOENT, e so ela', () => {
    expect(ausenciaEsperada({ code: 'ENOENT' })).toBe(true);
    expect(ausenciaEsperada({ code: 'EACCES' })).toBe(false);
    expect(ausenciaEsperada({ code: 'EPERM' })).toBe(false);
  });

  it('nao confunde erro sem codigo com ausencia', () => {
    expect(ausenciaEsperada(new Error('coisa'))).toBe(false);
    expect(ausenciaEsperada(null)).toBe(false);
    expect(ausenciaEsperada(undefined)).toBe(false);
  });
});

// ── Entradas ocultas na arvore ──────────────────────────────────────────────
import { entradaOcultaNaArvore } from '../../main/ipc/files_ops.js';

describe('entradaOcultaNaArvore', () => {
  it('esconde a pasta de config do slang, que e do servidor e nao do usuario', () => {
    expect(entradaOcultaNaArvore('.slang')).toBe(true);
  });

  it('nao esconde por regra geral de ponto: .git, .vscode e .gitignore continuam', () => {
    for (const n of ['.git', '.vscode', '.gitignore', 'src', 'proc1', '']) {
      expect(entradaOcultaNaArvore(n)).toBe(false);
    }
  });
});
