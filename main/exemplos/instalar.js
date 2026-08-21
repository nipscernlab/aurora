// @ts-check
/**
 * instalar.js: cria os projetos de exemplo na pasta que o usuario escolher.
 *
 * POR QUE OS FONTES VIAJAM DENTRO DO APLICATIVO
 * ---------------------------------------------
 * A alternativa seria baixa-los do GitHub na hora. Nao vale a pena: sao alguns
 * kilobytes de texto, e amarra-los a rede transformaria "quero ver um exemplo"
 * numa operacao que falha atras do proxy do laboratorio, ou que muda de
 * conteudo entre uma turma e outra sem ninguem perceber. Aqui eles sao parte
 * da versao instalada, como o manual.
 *
 * O PROJETO SAI PRONTO, MAS NAO SAI COMPILADO
 * -------------------------------------------
 * Cada exemplo chega com o `.spf` escrito e o testbench registrado, entao o
 * aluno abre e ja tem um projeto valido. O que NAO vem e o Verilog do
 * processador: ele e gerado pela compilacao do C±, e a arvore o descobre
 * sozinha depois (js/project/file_mode.js, _discoverProcessorFiles). Escreve-lo
 * no `.spf` de antemao apontaria para um arquivo inexistente, e o projeto
 * abriria acusando arquivo faltante logo na primeira vez, que e a pior
 * primeira impressao possivel.
 *
 * INSTALAR DUAS VEZES NAO SOBRESCREVE
 * -----------------------------------
 * Uma pasta que ja existe e pulada, e o relatorio diz que foi pulada. O aluno
 * que mexeu no exemplo e clicou de novo no botao nao pode perder o que
 * escreveu; quem quer o exemplo original de volta apaga a pasta, que e uma
 * acao explicita e reversivel ate a Lixeira.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** A pasta dos exemplos dentro da instalacao. */
function raiz() {
  return path.join(require('../paths').appRoot, 'resources', 'exemplos');
}

/** Le o catalogo. Lanca quando ele falta, porque sem ele nao ha o que instalar. */
function lerCatalogo(base = raiz()) {
  const bruto = fs.readFileSync(path.join(base, 'catalogo.json'), 'utf8');
  const doc = JSON.parse(bruto);
  if (!Array.isArray(doc.exemplos) || doc.exemplos.length === 0) {
    throw new Error('catalogo de exemplos vazio');
  }
  return doc.exemplos;
}

/** O catalogo para a interface: o que mostrar, sem caminho de disco. */
function listar(base = raiz()) {
  return lerCatalogo(base).map((e) => ({
    chave: e.chave,
    nome: e.nome,
    resumo: e.resumo,
    linguagem: e.linguagem,
    processadores: e.processadores || [],
  }));
}

/** Copia uma arvore inteira, criando o que faltar. */
function copiarArvore(origem, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const entrada of fs.readdirSync(origem, { withFileTypes: true })) {
    const de = path.join(origem, entrada.name);
    const para = path.join(destino, entrada.name);
    if (entrada.isDirectory()) copiarArvore(de, para);
    else fs.copyFileSync(de, para);
  }
}

/**
 * O `.spf` de um exemplo ja instalado no disco.
 *
 * Usa o mesmo `ProjectFile` que o "Novo Projeto" usa, e nao um objeto montado
 * a mao: o formato do `.spf` muda com o tempo, e duas fontes divergiriam sem
 * ninguem notar ate um projeto de exemplo abrir errado.
 *
 * @param {string} destinoProjeto  pasta ja criada do projeto
 * @param {any} exemplo  entrada do catalogo
 */
function montarSpf(destinoProjeto, exemplo) {
  const { ProjectFile } = require('../ipc/project');
  const projeto = new ProjectFile(destinoProjeto);
  const abs = (rel) => path.join(destinoProjeto, ...String(rel).split('/'));

  projeto.structure.processors = (exemplo.processadores || []).map((name) => ({ name }));

  if (exemplo.testbench) {
    const tb = abs(exemplo.testbench);
    projeto.structure.testbenchFile = tb;
    projeto.structure.testbenchFiles = [
      { name: path.basename(tb), path: tb, isTopLevel: false },
    ];
  }
  if (exemplo.topLevel) {
    const top = abs(exemplo.topLevel);
    projeto.structure.topLevelFile = top;
    projeto.structure.synthesizableFiles = [
      { name: path.basename(top), path: top, isTopLevel: true },
    ];
  }
  return projeto.toJSON();
}

/**
 * Instala todos os exemplos em `destino`.
 *
 * Cada um vira uma pasta propria com o `.spf` dentro, entao o destino escolhido
 * fica com cinco projetos lado a lado e nenhum deles engole o outro.
 *
 * Nao lanca por causa de um exemplo: um que falhe e relatado e os outros
 * seguem. Quem clicou no botao prefere quatro exemplos e um recado a nenhum
 * exemplo e um recado.
 *
 * @param {string} destino
 * @param {{ base?: string }} [opcoes]
 * @returns {{ criados: Array<{chave:string, nome:string, spf:string}>,
 *             pulados: Array<{chave:string, motivo:string}> }}
 */
function instalar(destino, opcoes = {}) {
  const base = opcoes.base || raiz();
  if (!destino) throw new Error('destino obrigatorio');
  fs.mkdirSync(destino, { recursive: true });

  const criados = [];
  const pulados = [];
  for (const exemplo of lerCatalogo(base)) {
    const pasta = path.join(destino, exemplo.chave);
    try {
      if (fs.existsSync(pasta)) {
        pulados.push({ chave: exemplo.chave, motivo: 'ja existe' });
        continue;
      }
      copiarArvore(path.join(base, exemplo.chave), pasta);
      const spf = path.join(pasta, `${exemplo.chave}.spf`);
      fs.writeFileSync(spf, JSON.stringify(montarSpf(pasta, exemplo), null, 2), 'utf8');
      criados.push({ chave: exemplo.chave, nome: exemplo.nome, spf });
    } catch (e) {
      pulados.push({ chave: exemplo.chave, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return { criados, pulados };
}

module.exports = { listar, instalar, lerCatalogo, montarSpf, raiz };
