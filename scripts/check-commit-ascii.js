// check-commit-ascii.js — mantem a mensagem de commit em ASCII.
//
// O changelog das releases vinha com simbolo quebrado, e a origem nao era o
// git: os bytes gravados estao certos, `e2 80 94` para o travessao. Quem
// estraga e o caminho ate a release, onde o release-please monta o corpo e o
// travessao chega como U+0014, um caractere de controle, que o navegador
// desenha como losango. Sobrou de um truncamento de 16 para 8 bits: 0x2014
// virou 0x14.
//
// Nao da para consertar isso do lado de ca, e reescrever historia publicada
// para arrumar acento nao se paga. O que da para fazer e nao alimentar o
// problema: mensagem de commit so com ASCII. O texto do projeto continua com
// acento onde importa, na interface, nos locales e na documentacao, que sao
// arquivos e nao passam por esse caminho.
//
// Uso: node scripts/check-commit-ascii.js <arquivo-da-mensagem>

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('uso: node scripts/check-commit-ascii.js <arquivo>');
  process.exit(2);
}

const raw = fs.readFileSync(file, 'utf8');
// Comentario de template do git nao conta: ele nao vai para a mensagem.
const msg = raw.split('\n').filter((l) => !l.startsWith('#')).join('\n');

const ofensores = [];
for (const linha of msg.split('\n')) {
  const encontrados = [...linha].filter((c) => c.charCodeAt(0) > 127);
  if (encontrados.length) {
    ofensores.push({ linha, chars: [...new Set(encontrados)] });
  }
}

if (!ofensores.length) process.exit(0);

console.error('\nA mensagem de commit tem caracteres fora do ASCII:\n');
for (const o of ofensores) {
  const lista = o.chars
    .map((c) => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`)
    .join(', ');
  console.error(`  ${o.linha.trim().slice(0, 72)}`);
  console.error(`    -> ${lista}\n`);
}
console.error('Eles sobrevivem ao git e morrem no caminho ate a release: o');
console.error('release-please entrega o travessao como U+0014 e o GitHub desenha');
console.error('um losango. Troque por ASCII (travessao vira virgula ou dois-pontos,');
console.error('seta vira "->", acento sai) e comite de novo.\n');
process.exit(1);
