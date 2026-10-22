/**
 * Onde os componentes baixados moram, e por que nao pode ser dentro da pasta
 * de instalacao.
 *
 * Numa atualizacao, o desinstalador do electron-builder executa
 * `RMDir /r $INSTDIR` ANTES de o novo instalador rodar (o template esta em
 * app-builder-lib/templates/nsis/uninstaller.nsh). Enquanto todo componente
 * vinha dentro do instalador isso era inofensivo. Depois que passaram a ser
 * baixados, qualquer caminho debaixo de $INSTDIR significa o usuario perder
 * ate 955 MB a cada release e re-baixar tudo.
 *
 * Este teste existe porque a regressao seria silenciosa: nada quebra no CI,
 * nada falha no boot, e o prejuizo so aparece na maquina de quem atualiza.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { componentesPersistentes } from '../../main/paths.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXE = 'C:\\Users\\alguem\\AppData\\Local\\Programs\\sapho\\sapho.exe';
const LOCAL = 'C:\\Users\\alguem\\AppData\\Local';
const ROAMING = 'C:\\Users\\alguem\\AppData\\Roaming\\sapho';

describe('componentesPersistentes', () => {
  it('fica FORA da pasta de instalacao', () => {
    const destino = componentesPersistentes(EXE, LOCAL, ROAMING);
    const instalacao = path.dirname(EXE);
    expect(destino.toLowerCase().startsWith(instalacao.toLowerCase())).toBe(false);
  });

  it('usa o LOCALAPPDATA, e nao o roaming', () => {
    // Perfil roaming de universidade sincroniza pela rede a cada login. Um
    // gigabyte de toolchain ali seria um problema para o laboratorio inteiro,
    // e nao apenas espaco gasto.
    const destino = componentesPersistentes(EXE, LOCAL, ROAMING);
    expect(destino).toBe(path.join(LOCAL, 'SAPHO', 'components'));
    expect(destino).not.toContain('Roaming');
  });

  it('cai no userData quando nao ha LOCALAPPDATA', () => {
    const destino = componentesPersistentes(EXE, undefined, ROAMING);
    expect(destino).toBe(path.join(ROAMING, 'SAPHO', 'components'));
  });

  it('sem nenhuma base, volta para o lado do executavel em vez de ficar sem caminho', () => {
    // Perde a sobrevivencia a atualizacao, mas o aplicativo continua
    // funcionando; um caminho vazio quebraria tudo.
    const destino = componentesPersistentes(EXE, undefined, undefined);
    expect(destino).toBe(path.join(path.dirname(EXE), 'components'));
  });
});

describe('o instalador acompanha a mesma regra', () => {
  const nsh = fs.readFileSync(path.join(RAIZ, 'build', 'installer.nsh'), 'utf8');

  it('copia os componentes para a pasta persistente', () => {
    expect(nsh).toContain('$LOCALAPPDATA\\SAPHO\\components');
  });

  it('so apaga os componentes numa desinstalacao de verdade', () => {
    // Sem o guarda de isUpdated, atualizar apagaria o que o usuario baixou,
    // que e exatamente o defeito que esta mudanca existe para corrigir.
    expect(nsh).toContain('${IfNot} ${isUpdated}');
    const trecho = nsh.slice(nsh.indexOf('customUnInstall'));
    expect(trecho).toContain('RMDir /r "$LOCALAPPDATA\\SAPHO\\components"');
  });

  it('traz o que ficou de instalacoes antigas em vez de re-baixar', () => {
    expect(nsh).toContain('$INSTDIR\\components\\Packages');
  });

  it('as pastas do yanc saem antes da copia, e so quando o instalador as traz (issue 213)', () => {
    // Copiar por cima deixava o appcomp e o cpppp da v6 em bin\ depois da v7.1.
    const instalar = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macro customUnInstall'));
    const copia = instalar.indexOf('CopyFiles /SILENT "$INSTDIR\\resources\\components_tmp');
    for (const pasta of ['bin', 'SAPHO', 'Header', 'Macros']) {
      const limpa = instalar.indexOf(`!insertmacro SubstituirPastaDoYanc "${pasta}"`);
      expect(limpa, pasta).toBeGreaterThan(-1);
      expect(limpa, pasta).toBeLessThan(copia);
    }
    const macro = nsh.slice(nsh.indexOf('!macro SubstituirPastaDoYanc'), nsh.indexOf('!macro customInstall'));
    expect(macro).toContain('${If} ${FileExists} "$INSTDIR\\resources\\components_tmp\\${PASTA}\\*"');
    expect(macro).toContain('RMDir /r "$LOCALAPPDATA\\SAPHO\\components\\${PASTA}"');
  });
});
