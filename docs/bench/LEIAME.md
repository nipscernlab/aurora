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

Duas regras para o numero valer. Rodar `npm run build:renderer` antes, senao
o bench mede o bundle velho. E comparar so medidas da mesma maquina: o CSV
nao registra o hardware, e o boot de um laptop com antivirus acordando nao se
compara com o de uma estacao do laboratorio.
