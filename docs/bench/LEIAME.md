# Medidas de desempenho

O arquivo `medidas.csv` guarda uma linha por medicao da AURORA, gerada por
`npm run bench` (o script e `scripts/bench.js`, e o cabecalho dele explica
cada coluna e o porque de cada uma). A ideia e simples: a cada correcao ou
atualizacao que possa mexer em tempo ou memoria, roda-se o bench antes e
depois, e a diferenca fica registrada com o commit medido. Na hora de escrever
um artigo, a frase "a interface abre em tantos milissegundos" tem origem, data
e versao.

As colunas sao data, commit (com um `+` no fim quando havia mudanca nao
commitada), versao do package.json, numero de repeticoes, e as medianas de:
boot_ms (lancamento ate o Monaco existir), projeto_ms (abrir o projeto ate a
arvore aparecer), editor_ms (clique no .cmm ate o modelo do Monaco existir),
diag_ms (abrir o top level ate o primeiro diagnostico do slang; vazio sem o
slang-server), heap_mb e nos_dom (renderer principal depois de tudo assentar),
ws_mb (working set de todos os processos do app), dist_kb (js e css em
dist/assets) e cmm_ms (compilacao C+- do exemplo, so com `--compilar`). A
ultima coluna e uma nota livre, passada com `--nota`.

Tres regras para o numero valer. Rodar `npm run build:renderer` antes, senao
o bench mede o bundle velho. Comparar so medidas da mesma maquina: o CSV
nao registra o hardware, e o boot de um laptop com antivirus acordando nao se
compara com o de uma estacao do laboratorio. E, quando um numero se mover,
medir um CONTROLE antes de acreditar nele: o mesmo commit de antes, na mesma
sessao, com `git checkout <commit> -- index.html main.js html js main
vite.config.mjs`, build e bench, e depois `git checkout HEAD -- ...`.

A terceira regra nasceu em 03/09/2026. A primeira medicao do dia deu boot de
6,3 s e heap de 48 MB; a mesma tarde, depois dos commits da auditoria, 7,8 a
8,8 s e 69 MB, em tres repeticoes, o que parecia uma regressao clara. Nao era:
o codigo de antes, medido naquela hora, deu 8,9 s e 69 MB, os mesmos numeros.
A maquina e que tinha mudado, com o Defender revarrendo `node_modules` e
`dist/` reescritos por um `npm install` e por uma tarde de builds e testes. O
CSV guarda as linhas do experimento e do controle, com a nota dizendo o que
sao, porque sem elas a serie contaria uma regressao que nao houve.
