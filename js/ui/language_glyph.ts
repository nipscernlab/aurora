/**
 * language_glyph.ts: o glifo da linguagem de processador, num lugar so.
 *
 * A AURORA desenha o C+- com traco proprio, e nao com um icone do tema
 * Material, porque nenhum tema tem esse simbolo. Com o C++ entrando como
 * segunda linguagem, o mesmo desenho ganhou uma variante: o traco de baixo do
 * mais-menos vira um segundo mais.
 *
 * Ate aqui, QUATRO lugares respondiam sozinhos "este arquivo usa o glifo da
 * AURORA?", cada um com o seu `endsWith('.cmm')`: o mapa de icones das abas
 * (tab_utils), as duas arvores de arquivo (standard_tree_render e
 * project_tree_render) e a previa de criacao em linha (standard_tree_crud).
 * Acrescentar o C++ em quatro lugares e esquecer um deles daria um arquivo
 * com o icone errado em uma arvore e certo na outra. Aqui mora a resposta.
 *
 * Compilado por `tsc` (npm run build:ts) num language_glyph.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import {
  languageFromFileName,
  type ProcessorLanguage,
} from '../compilation/processor_source.js';

/** A classe CSS do glifo mascarado de cada linguagem (theme_variables.css). */
const CLASSE: Readonly<Record<ProcessorLanguage, string>> = Object.freeze({
  cmm: 'aurora-icon-cmm',
  cpp: 'aurora-icon-cpp',
});

/** Todas as classes de glifo, para quem precisa limpar antes de pintar. */
export function glyphClasses(): string[] {
  return Object.values(CLASSE);
}

/**
 * A classe do glifo para um nome de arquivo, ou `null` quando o arquivo nao e
 * fonte de processador e deve usar o icone do tema.
 */
export function glyphClassForFile(fileName: unknown): string | null {
  const language = languageFromFileName(fileName);
  return language ? CLASSE[language] : null;
}

/**
 * Poe (ou tira) o glifo certo num elemento de icone, deixando so uma das
 * classes ligada. Devolve `true` quando pintou um glifo da AURORA, para quem
 * chama saber que nao precisa do icone do tema.
 */
export function applyGlyphToIcon(icon: Element | null | undefined, fileName: unknown): boolean {
  if (!icon) return false;
  const alvo = glyphClassForFile(fileName);
  for (const classe of glyphClasses()) icon.classList.toggle(classe, classe === alvo);
  return alvo !== null;
}

/**
 * Acende a variante C++ do glifo DESENHADO (o `<svg>` inline do botao de
 * compilar e da aba do terminal), trocando o traco de baixo do mais-menos por
 * um segundo mais. O desenho tem os dois tracos; quem escolhe e esta classe,
 * em CSS, para nao haver manipulacao de path em JavaScript.
 */
export function setDrawnGlyphLanguage(root: ParentNode | null | undefined, language: ProcessorLanguage): void {
  if (!root) return;
  for (const glifo of root.querySelectorAll('.glyph-cpm')) {
    glifo.classList.toggle('is-cpp', language === 'cpp');
  }
}

/**
 * O rotulo curto da linguagem, o mesmo texto que a aba do terminal mostra.
 * Nao passa pelo i18n de proposito: "C±" e "C++" sao nomes proprios e sao
 * iguais nas duas linguas (ver locales, toolbar.termTabLabel.cmm).
 */
export function languageLabel(language: ProcessorLanguage): string {
  return language === 'cpp' ? 'C++' : 'C±';
}
