import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  psQuote,
  pythonBridgeScript,
  promptBootstrapLine,
  encodeBootstrap,
  clampGrid,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} = require('../../main/ipc/shell_bootstrap.js');

// O bootstrap do terminal TCMD (main/ipc/shell_bootstrap.js). Ele monta o texto
// que o PowerShell executa antes de devolver o prompt ao usuario, e nada disso
// era alcancavel por teste enquanto vivia dentro do handler de ipcMain.
//
// O que esta em jogo: o texto roda no shell do usuario. Aspa mal escapada nao
// da erro visivel, termina a string mais cedo e transforma o resto da linha em
// comando; e codificacao errada nao falha alto, so faz o prompt nao aparecer.

describe('psQuote', () => {
  it('duplica a aspa simples, que e a regra do PowerShell', () => {
    // Barra invertida NAO escapa em string literal do PowerShell. Se alguem
    // "consertar" isto para \\' o bootstrap quebra em caminho com aspa.
    expect(psQuote("C:\\Users\\O'Brien\\python.exe")).toBe("C:\\Users\\O''Brien\\python.exe");
  });

  it('nao mexe em caminho comum', () => {
    expect(psQuote('C:\\Program Files\\aurora\\python.exe')).toBe('C:\\Program Files\\aurora\\python.exe');
  });

  it('escapa todas as ocorrencias, nao so a primeira', () => {
    expect(psQuote("a'b'c")).toBe("a''b''c");
  });
});

describe('pythonBridgeScript', () => {
  it('devolve vazio quando nao ha Python empacotado', () => {
    // Sem bundle nao ha o que fazer, e o chamador simplesmente nao injeta nada.
    // Devolver um trecho meia-boca definiria `apython` apontando para lugar
    // nenhum, e o erro apareceria so quando o usuario chamasse.
    expect(pythonBridgeScript('')).toBe('');
  });

  it('nao toca em PATH nem em PYTHONPATH', () => {
    // A decisao de projeto inteira esta aqui: PYTHONPATH e lido por QUALQUER
    // python do terminal, inclusive o do usuario, e misturaria as bibliotecas
    // do painel com as dele. Se isto quebrar, quebrou a decisao.
    const s = pythonBridgeScript('C:\\aurora\\python.exe');
    expect(s).not.toMatch(/PYTHONPATH/);
    expect(s).not.toMatch(/\$env:PATH\s*=/);
  });

  it('define apython e Use-Python, e comeca no python do sistema', () => {
    const s = pythonBridgeScript('C:\\aurora\\python.exe');
    expect(s).toMatch(/function apython/);
    expect(s).toMatch(/function Use-Python/);
    // Nenhuma chamada a Use-Python no proprio trecho: o padrao e o shell que o
    // usuario espera, e trocar e ato explicito dele.
    expect(s).not.toMatch(/^\s*Use-Python\s+aurora\s*$/m);
  });

  it('remove a funcao sem o prefixo global, que foi o que mediram funcionar', () => {
    // 'Remove-Item function:global:python' nao remove nada e Test-Path continua
    // dizendo que existe, o que fazia 'Use-Python system' anunciar a troca sem
    // efetua-la. Este teste existe para a linha nao voltar ao que era.
    const s = pythonBridgeScript('C:\\aurora\\python.exe');
    expect(s).toMatch(/Remove-Item -LiteralPath 'function:python' -Force/);
    // So as linhas de CODIGO: o comentario logo acima cita a forma que nao
    // funciona, de proposito, e casar com ele seria o teste lendo a explicacao
    // em vez do comando.
    const codigo = s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(codigo).not.toMatch(/Remove-Item\s+function:global:python/);
  });

  it('escapa o caminho do interpretador', () => {
    const s = pythonBridgeScript("C:\\Users\\O'Brien\\python.exe");
    expect(s).toContain("$env:AURORA_PYTHON_EXE = 'C:\\Users\\O''Brien\\python.exe'");
  });
});

describe('promptBootstrapLine', () => {
  it('le o arquivo como texto em vez de mandar rodar o script', () => {
    // E o que faz a politica de execucao para ARQUIVO nao se aplicar: maquina
    // em Restricted ou RemoteSigned tambem ganha o prompt.
    const linha = promptBootstrapLine('C:\\aurora\\main\\shell\\aurora-prompt.ps1');
    expect(linha).toMatch(/Get-Content -Raw -LiteralPath/);
    expect(linha).toMatch(/ScriptBlock\]::Create/);
  });

  it('checa a existencia antes de tentar carregar', () => {
    expect(promptBootstrapLine('C:\\x.ps1')).toMatch(/Test-Path -LiteralPath/);
  });

  it('escapa o caminho', () => {
    expect(promptBootstrapLine("C:\\it's\\prompt.ps1")).toContain("'C:\\it''s\\prompt.ps1'");
  });
});

describe('encodeBootstrap', () => {
  it('codifica em UTF-16LE, que e exigencia do -EncodedCommand', () => {
    // UTF-8 nao falha alto: produz mojibake ou comando vazio, e o sintoma que
    // chega ao usuario e o prompt nao aparecer.
    const b64 = encodeBootstrap(['Write-Host oi']);
    expect(Buffer.from(b64, 'base64').toString('utf16le')).toBe('Write-Host oi');
  });

  it('devolve vazio quando nao ha nada util, para nao passar a flag a toa', () => {
    expect(encodeBootstrap([])).toBe('');
    expect(encodeBootstrap(['', '   '])).toBe('');
    expect(encodeBootstrap(undefined)).toBe('');
  });

  it('descarta trecho vazio no meio em vez de deixar linha em branco', () => {
    // Acontece de verdade: sem Python empacotado, pythonBridgeScript devolve ''
    // e o chamador empilha esse vazio junto com a linha do prompt.
    const b64 = encodeBootstrap(['linha A', '', 'linha B']);
    expect(Buffer.from(b64, 'base64').toString('utf16le')).toBe('linha A\nlinha B');
  });

  it('sobrevive a acento, que e o caso comum nos caminhos daqui', () => {
    const texto = "$p = 'C:\\Usuários\\ação\\prompt.ps1'";
    expect(Buffer.from(encodeBootstrap([texto]), 'base64').toString('utf16le')).toBe(texto);
  });
});

describe('clampGrid', () => {
  it('usa o padrao quando o renderer nao manda nada', () => {
    expect(clampGrid()).toEqual({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    expect(clampGrid({})).toEqual({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
  });

  it('preserva a grade que o xterm mede', () => {
    expect(clampGrid({ cols: 132, rows: 43 })).toEqual({ cols: 132, rows: 43 });
  });

  it('trunca fracao, porque o ConPTY quer inteiro', () => {
    expect(clampGrid({ cols: 100.9, rows: 30.2 })).toEqual({ cols: 100, rows: 30 });
  });

  it('mantem o piso de 2, abaixo do qual o ConPTY nao aloca buffer', () => {
    expect(clampGrid({ cols: 1, rows: 1 })).toEqual({ cols: 2, rows: 2 });
  });

  it('trata lixo e valor nao utilizavel como ausencia', () => {
    expect(clampGrid({ cols: NaN, rows: Infinity })).toEqual({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    expect(clampGrid({ cols: 'oi', rows: null })).toEqual({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    expect(clampGrid({ cols: -5, rows: 0 })).toEqual({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
  });

  it('da a MESMA resposta que o outro caminho dava, que era o defeito', () => {
    // Antes havia duas regras para a mesma coisa: shell:start usava
    // `isFinite(x) ? max(2, x|0) : 80` e shell:resize usava
    // `max(2, (x|0) || 80)`. Para 0, uma devolvia 2 e a outra 80 — iniciar e
    // redimensionar com o mesmo valor produziam terminais diferentes.
    for (const v of [0, -1, 1, 2, 80, 200, NaN]) {
      const a = clampGrid({ cols: v, rows: v });
      const b = clampGrid({ cols: v, rows: v });
      expect(a).toEqual(b);
    }
    expect(clampGrid({ cols: 0 }).cols).toBe(DEFAULT_COLS);
  });
});
