// @ts-check
/**
 * spf_locator_rules.js: as decisões da varredura que procura um `.spf` sumido,
 * separadas do que toca disco.
 *
 * O caso: o usuário move ou renomeia a pasta de um projeto, e a entrada dos
 * recentes fica apontando para o lugar antigo. O nome do arquivo `.spf`
 * continua o mesmo, então dá para reencontrá-lo varrendo o disco, e é isso
 * que o botão "Localizar" faz. Aqui ficam as três decisões que valem teste:
 * onde NÃO entrar, por onde começar, e qual alvo um achado resolve.
 *
 * ONDE NÃO ENTRAR importa mais do que parece: uma varredura que entra em
 * node_modules ou no Windows passa minutos em pastas onde um projeto nunca
 * esteve, e o usuário desiste dela antes de ela chegar ao lugar certo.
 */

'use strict';

/** Pastas onde um projeto do usuário não mora. Comparação em minúsculas. */
const PASTAS_FORA = new Set([
  'node_modules', '.git', '__pycache__', 'windows', 'program files',
  'program files (x86)', 'programdata', 'appdata', '$recycle.bin',
  'system volume information', 'obj_dir', 'onedrivetemp', 'recovery',
  'perflogs', '$windows.~bt', 'msocache',
]);

/**
 * A varredura deve entrar nesta pasta?
 *
 * Nome que começa com ponto ou cifrão é infraestrutura (`.vscode`, `.cache`,
 * `$Recycle.Bin`): um `.spf` de aluno não mora lá, e cada uma dessas custa
 * milhares de arquivos irrelevantes.
 *
 * @param {any} nome so o nome do diretorio, nao o caminho
 */
function dirEntra(nome) {
  const n = String(nome || '').toLowerCase();
  if (!n) return false;
  if (n.startsWith('.') || n.startsWith('$')) return false;
  return !PASTAS_FORA.has(n);
}

/**
 * A ordem das raízes: primeiro onde projetos costumam morar, depois o resto.
 *
 * A varredura é a mesma nos dois casos; a ordem é o que faz o achado comum
 * (Desktop, Documentos) aparecer em segundos em vez de minutos. O conjunto
 * visitado do chamador resolve a sobreposição entre o perfil e a raiz do
 * disco que o contém.
 *
 * @param {string} home pasta do perfil do usuario
 * @param {string[]} drives raizes existentes, ex: ['C:\\', 'D:\\']
 * @returns {string[]}
 */
function ordenarRaizes(home, drives) {
  const sep = home.includes('/') ? '/' : '\\';
  const dentro = (n) => `${home}${sep}${n}`;
  const lista = [
    dentro('Desktop'), dentro('Documents'), dentro('Downloads'),
    dentro('OneDrive'), home, ...(drives || []),
  ];
  const vistos = new Set();
  return lista.filter((p) => {
    const k = String(p || '').toLowerCase();
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

/**
 * Qual alvo um `.spf` encontrado resolve.
 *
 * Dois projetos podem ter arquivos de mesmo nome (`projeto.spf` em duas
 * pastas). O desempate é quantos segmentos FINAIS o caminho novo compartilha
 * com o caminho antigo de cada alvo: quem mudou só a pasta de cima mantém a
 * cauda inteira, e é dele o achado. Empate vai para o primeiro, que é o mais
 * antigo na lista.
 *
 * @param {string[]} chaves caminhos antigos dos alvos ainda nao resolvidos
 * @param {string} achado caminho novo encontrado no disco
 * @returns {string|null} a chave vencedora
 */
function melhorAlvo(chaves, achado) {
  const seg = (p) => String(p || '').toLowerCase().split(/[\\/]+/).filter(Boolean);
  const novo = seg(achado);
  let melhor = null;
  let melhorPonto = -1;
  for (const chave of chaves || []) {
    const velho = seg(chave);
    let iguais = 0;
    while (
      iguais < velho.length && iguais < novo.length
      && velho[velho.length - 1 - iguais] === novo[novo.length - 1 - iguais]
    ) iguais++;
    if (iguais > melhorPonto) { melhorPonto = iguais; melhor = chave; }
  }
  return melhor;
}

module.exports = { PASTAS_FORA, dirEntra, ordenarRaizes, melhorAlvo };
