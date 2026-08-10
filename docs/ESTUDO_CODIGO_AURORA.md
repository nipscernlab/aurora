# Como a AURORA funciona por dentro

Estudo do código feito em 07/08/2026, lendo os arquivos e não a documentação
existente. Ele é a fundação para a reescrita dos demais documentos e para as
mudanças grandes que vêm depois. Toda afirmação aqui foi conferida no código; o
que não foi verificado está dito como não verificado, na última seção.

O estudo de achados e prioridades continua sendo o
[ESTUDO_COMPLETO_AURORA.md](ESTUDO_COMPLETO_AURORA.md). Este aqui responde outra
pergunta: como a coisa é montada.

## O tamanho da coisa

São cerca de 95 mil linhas de código rastreadas. O renderer domina, com 48 mil
linhas em 146 arquivos sob `js/`. O processo principal tem 18 mil em 60 arquivos
sob `main/`. O CSS soma 12,6 mil em 29 arquivos, os testes 8,9 mil em 66, os
scripts de bootstrap 3,7 mil em 18, e o HTML 3,4 mil em 6 páginas.

A distribuição interna é desigual de um jeito que importa. Três arquivos do
renderer concentram quase 9,5 mil linhas sozinhos: `js/ui/ai_assistant_manager.js`
com 3416, `js/compilation/compilation_module.js` com 3122 e `js/api/aurora_api.js`
com 2957. No processo principal a concentração se repete em menor escala, com
`main/ai/tools.js` em 1532, `main/ipc/project.js` em 982 e `main/ipc/prism.js` em
964. É o mesmo problema anotado como item 7 do [PENDENCIAS.md](PENDENCIAS.md), e
ele aparece aqui porque muda como se lê o projeto: a maior parte dos arquivos é
pequena e focada, e a dificuldade se concentra em meia dúzia deles.

## Como o aplicativo sobe

O `main.js` é só fiação, e a ordem dele é deliberada. Primeiro configura o
logger, antes de qualquer coisa poder logar. Depois instala a rede de segurança
do processo principal, que é o `crashReporter` com minidump local mais os
manipuladores de `uncaughtException` e `unhandledRejection`; antes disso existir,
uma exceção fora de um callback de IPC derrubava o processo sem deixar registro e
com os filhos da toolchain órfãos.

Em seguida vêm três chaves de linha de comando do Chromium, que precisam ser
apendadas antes de o app ficar pronto porque o processo de GPU as lê no
lançamento. Duas são de rasterização, e a terceira, `force_high_performance_gpu`,
resolve um problema concreto: em máquina com gráficos híbridos o Chromium escolhe
a GPU integrada para o processo de GPU, e o `powerPreference` por contexto que o
canvas da aurora pede não move isso de forma confiável, o que deixava o shader do
fundo animado na GPU fraca. O comentário registra também o que foi deliberadamente
não feito, `disable-frame-rate-limit`, porque remover a cadência de vsync deixava
os laços de `requestAnimationFrame` da splash rodarem soltos e travarem a própria
splash.

O `AppUserModelID` é registrado antes de existir qualquer janela, para o Windows
associar o processo a uma identidade estável de jumplist. Registrar depois, como
era feito de dentro do `createMainWindow`, deixava o agrupamento da barra de
tarefas preso à identidade embutida do `electron.exe`.

Só então entra o `lifecycle.register()`, que pega a trava de instância única e
devolve falso se perdeu; nesse caso o `main.js` para ali e não registra mais
nada, para não deixar manipuladores em um processo que está morrendo. Com a trava
na mão, dezenove módulos registram seus canais de IPC, e por último a splash é
criada. É ela quem agenda a criação da janela principal, não o contrário.

Dentro do `app.whenReady` acontecem quatro coisas fáceis de perder de vista. Uma
pasta `tmp` é criada dentro do MSYS, porque bash e make resolvem `/tmp` para lá e
um pacote recém-copiado pode não trazer o diretório vazio. A pasta de rascunho
`components/Temp` é limpa de forma síncrona antes de a janela existir, que é a
rede para o caso de a limpeza de saída não ter rodado por causa de uma queda. A
jumplist é montada. E a política de segurança de conteúdo é instalada como
cabeçalho de resposta na sessão padrão, com cada diretiva justificada no
comentário, incluindo o motivo de `unsafe-eval` existir, que é o carregador AMD do
Monaco.

## Fechamento, e por que ele é em duas fases

O `before-quit` no `main/lifecycle.js` faz a limpeza em duas fases serializadas, e
a razão é específica do Windows. Os vigias de arquivo do chokidar usam
`ReadDirectoryChangesW`, e processos como `vvp` e `gtkwave` seguram descritores
dentro de `components/Temp`. Se a remoção da pasta rodar antes de todos soltarem,
o Windows bloqueia o `rmdir` e a pasta acumula lixo das execuções anteriores.

A fase um fecha os vigias de arquivo e de diretório, para todos os filhos da
toolchain pelo `process_registry`, e derruba o servidor MCP local. Ela corre
contra um limite de cinco segundos, para que um travamento não impeça o programa
de fechar. A fase dois apaga e recria a `Temp`.

## A fronteira entre os dois processos

O renderer não fala com o sistema. O `js/app/preload.js` usa `contextBridge` e
expõe quatro espaços de nomes, `electronAPI`, `terminalAPI`, `aiAPI` e `gitAPI`,
enumerando 203 canais um a um. Não existe ponte genérica que aceite um nome de
canal vindo do renderer.

Do outro lado, catorze módulos em `main/ipc/` registram cerca de 142
manipuladores. Os maiores são `files.js` com trinta canais, `git.js` com vinte e
nove, `ai.js` com vinte e três e `project.js` com onze. A distribuição diz o que o
programa faz de verdade: manipular arquivos, falar com git, conversar com modelos
e gerir projetos.

## O pipeline de compilação

Esta é a parte mais interessante do desenho, e a filosofia está escrita no topo
do `js/compilation/compilation_flow.js`. A regra é ser preguiçoso do ponto de
vista do usuário: cada botão é autossuficiente, e ninguém precisa lembrar de
compilar antes de abrir ondas ou o PRISM. O custo aceito é retrabalho, porque
cada clique recompila o que for preciso.

Na prática todo botão expande para a mesma sequência base. Verilog é `cmm` mais
`asm` mais `iverilog` com `-tnull` sobre o topo. PRISM é o Verilog seguido de
yosys. Wave é `cmm` mais `asm` mais `iverilog` gerando o `vvp`, depois `vvp` e
depois o visualizador.

O detalhe elegante é que os laços de `cmm` e `asm` percorrem
`window.availableProcessors`, o que os torna nulos por construção em projeto de
Verilog puro, já que um vetor vazio produz laço vazio. Não existe nenhum ramo
condicional do tipo "se tem processador" dentro do pipeline.

## Editor

O Monaco é carregado globalmente pelo `index.html`, através do próprio carregador
AMD, e é por isso que a política de segurança precisa de `unsafe-eval`.

O `js/editor/monaco_editor.js` mantém um `Map` estático de editores, um por
arquivo aberto, cada um com `automaticLayout: true`. Os modelos, porém, são
compartilhados por um `SharedModelRegistry` com `acquire` e `release`. Ou seja, o
conteúdo não é duplicado, mas a view sim, e é essa duplicação que o item P1 do
estudo de achados aponta como custo de memória e de relayout.

O `js/editor/split_editor.js` sustenta até três painéis lado a lado, cada um com
a própria barra de abas, com atenuação visual nos painéis sem foco e divisores
arrastáveis entre eles.

O `monaco-editor` está preso na versão exata 0.52.2, e o motivo está no
`scripts/check-pinned-versions.js`: a 0.53.0 lança exceção dentro do próprio
`monaco.contribution.js` durante a inicialização e deixa o editor pela metade,
com cursor aparecendo e digitação morta.

## Árvore de arquivos e projeto

O `js/tree/file_tree_manager.js` cuida do arranque da árvore, do vigia de
diretório e do estado vazio. As linhas de arquivo em si são desenhadas por dois
renderizadores diferentes, a visão Verilog em `file_mode.js` e a visão de
hierarquia no `compilation_module.js`. O renderizador genérico antigo foi removido
em maio de 2026, junto com o resquício do modo IDE, porque era origem de um bug de
manipulador duplicado de abertura de arquivo.

Um ponto de desenho que vale registrar: o `ProjectTreeManager` não guarda o
caminho do projeto. Ele vive no `ProjectStore` como fonte única, e o comentário no
código diz por quê: cachear no manager era a causa raiz de arquivos sumirem ao
fechar e reabrir o projeto, porque o fechamento não limpava o cache e o caminho
velho era usado no retorno antecipado.

## Terminal

O `js/terminal/terminal_module.js` tem um teto rígido de nós retidos por terminal.
Sem ele, uma compilação em streaming do Verilator ou do iverilog acrescenta um nó
por linha sem limite, e cada passagem de recontagem, filtro ou rolagem fica mais
lenta até o painel travar. Existe um teto companheiro para os cartões agrupados,
porque um cartão agrupado é uma entrada só que pode acumular filhos sem limite.

O terminal interativo é separado, sobe do `shell_terminal.js` por importação de
efeito colateral, e usa PowerShell através do `@lydell/node-pty`. Esse pacote
distribui binários pré-compilados por plataforma, e o `conpty.node` usa N-API, o
que o torna estável entre versões de Node e de Electron. Foi o que permitiu o
salto de Electron 39 para 43 sem recompilar nada.

## Formas de onda

O `js/wave/wave_config_manager.js` é um seletor hierárquico de sinais. Ele caminha
pelos arquivos Verilog do projeto, monta uma árvore com raiz no módulo de
testbench, e deixa o usuário marcar o que entra no `$dumpvars`. A seleção persiste
por testbench, em `<projeto>/testbench/<chave>.json`, sob `waveSignals`.

Quando não há seleção salva, o padrão é todo sinal no escopo do módulo de
testbench, que espelha o comportamento implícito antigo de `$dumpvars(1, tb)`.
Quem nunca abrir o seletor continua tendo uma disposição de ondas sensata.

O botão Wave carrega duas escolhas independentes, e é fácil confundi-las porque
os módulos são espelhados de propósito.

A primeira é qual simulador roda, em `simulator_preference.js`. O padrão é o
iverilog da toolchain empacotada. A alternativa é o Verilator, que transpila para
C++, compila com g++ e executa um binário nativo, tipicamente de dez a cem vezes
mais rápido que o `vvp` em testbench longo, ao custo de análise mais estrita e da
dependência adicional do g++.

A segunda é qual visualizador abre, em `viewer_preference.js`. O padrão é o fork
NIPSCERN do GTKWave. A alternativa é o Surfer, escrito em Rust, no fork
`surfer-aurora`, que lê o mesmo VCD ou FST.

Os dois são janela externa. O comentário do `viewer_preference.js` chama o Surfer
de embutível, e até 07/08/2026 a dica da barra de ferramentas dizia ao usuário
"embedded (waves inside the IDE)", mas o `compilation_module.js` o lança com
`spawnTracked` como `surfer-aurora.exe` e a própria tradução fala em manter
janelas abertas para comparar execuções. Embutir o Surfer chegou a ser estudado e
está registrado como bloqueado, porque depende de um bundle WASM que o projeto
upstream não publica em formato baixável. A dica foi corrigida.

Ambas são globais e persistem em `localStorage`. A decisão de não guardar por
projeto ou por testbench está escrita no código: é escolha de ferramenta do
usuário, não propriedade da testbench, e guardá-la por testbench só inflaria o
WaveStore.

Cada visualizador tem seu escritor de configuração próprio, `gtkw_proc_writer.ts`
e `surfer_layout_writer.ts`, ambos em TypeScript, o que é incomum no projeto e
sugere que a geração desses arquivos foi considerada delicada o bastante para
merecer tipos.

A entrada do Surfer foi decidida por um estudo de viabilidade que recomendava
adotá-lo ao lado do GTKWave, escolhível por um botão, e não no lugar dele, e que
apontava um único obstáculo real: a decodificação de números complexos que o
`comp2gtkw` fazia. Tudo isso está feito. Os dois visualizadores convivem, e a
decodificação virou `js/wave/complex_decode.ts` com o canal `decode-complex` e
dez testes. O documento do estudo foi removido em 07/08/2026 por ter cumprido a
função; quem quiser o raciocínio original o encontra no histórico do git.

## PRISM

O `main/ipc/prism.js` é dono da janela do PRISM e de todas as etapas de
compilação do esquemático. O caminho é ler o Verilog, sintetizar com yosys, partir
o `hierarchy.json` em JSONs por módulo, e desenhar o SVG com o netlistsvg, que
aqui é um fork do NIPSCERN.

Há um detalhe de limpeza que revela como o pipeline é sensível: o código remove
prefixos `genblk<N>.` que o yosys acrescenta em instâncias geradas, senão os nomes
não batem com as skins.

As skins ficam em `assets/prism-skins/`, uma por módulo, e o
`scripts/gen-prism-skins.js` extrai a lista real de portas de cada módulo do HDL e
gera uma skin baseline para quem não tem uma feita à mão. Ele nunca sobrescreve
skin manual. A regra de correção documentada no script é que portas guardadas por
`ifdef YANC_SIM_VIS` precisam ser excluídas, porque o yosys lê o Verilog sem esse
define e a porta não existe na netlist; emitir uma âncora para ela faz o ELK
abortar.

O modo Simular usa digitaljs, carregado sob demanda, e é aí que mora a
dependência de jQuery. O `html/prism/prism.js` importa jQuery, publica em
`window.jQuery`, carrega o jQuery UI completo nesse global e só então o digitaljs,
porque os widgets dele chamam `$.widget` em tempo de avaliação. Essa ordem é o que
prende o projeto na geração 3 do jQuery.

## Aurora Intelligence

É o subsistema mais denso, com vinte arquivos em `main/ai/`. Existem dois caminhos
distintos para falar com modelos, e entender a diferença explica metade do
desenho.

O primeiro é o de API, em `chat.js`, que usa o Vercel AI SDK e liga o manifesto de
ferramentas do `tools.js` diretamente no SDK, de forma que o modelo recebe a
superfície de chamada de função da AURORA. Os provedores são carregados por
`tryRequire` em `provider.js`, cinco deles, e a ausência de um pacote não quebra
os outros.

O segundo é o de assinatura, em `claude_code.js` e `codex_cli.js`, que lança a CLI
correspondente em modo de impressão. Essas CLIs só conhecem as próprias
ferramentas embutidas, então sem ponte o modelo cairia para shell, chamando
`cmmcomp.exe` e `iverilog` por PowerShell. O `aurora_mcp_server.js` existe para
resolver isso: é um servidor HTTP MCP local que entrega o mesmo manifesto de
ferramentas para a CLI.

O manifesto declara 106 ferramentas, com nomes planos do tipo `get_active_file` e
`get_current_project`, agrupadas por assunto apenas pela ordem no arquivo. São os
mesmos grupos que a proposta de divisão arquivada em `archive/a2-godfiles` queria
transformar em módulos separados: compilação, editor, projeto, terminal, ondas,
configurações e regras. As chaves dos provedores ficam no `keystore.js`, e há um
`audit.js` registrando o que foi chamado.

## Build e distribuição

O renderer é montado pelo Vite. O `vite.config.mjs` faz uma coisa que merece
registro: reescreve os caminhos de `node_modules/` no HTML para as árvores em
`vendor/` que o `vite-plugin-static-copy` prepara. O HTML fonte mantém as
referências originais de propósito, para que a página crua ainda carregue direto
por `file://` na raiz do repositório, o que é a rede de segurança usada pelo
`main/windows.js`.

O empacotamento é feito pelo electron-builder, alvo NSIS x64, produto SAPHO,
`appId` `com.nipscern.sapho`, com asar ligado e só o `node-pty` desempacotado. A
publicação aponta para o repositório `nipscernlab/sapho`, que é o canal de
release, separado do `aurora`, onde o desenvolvimento acontece.

A toolchain não é versionada. O `npm run bootstrap` encadeia doze etapas, das
quais nove são downloads, cada um com sentinela para não baixar de novo:
toolchain com cocotb, yanc, GTKWave do NIPSCERN, Surfer, verible, clang-format,
slang-server, gramáticas do tree-sitter e o manual do SAPHO. As
outras três são a sincronia do manifesto das CLIs, a checagem de versões pinadas
e a ligação da pasta `components` para dentro do Electron. O
`scripts/verify-components.js` mantém um manifesto por máquina de qual tag está
instalada, para detectar quando uma versão muda.

O updater roda só em produção. Cerca de seis segundos após a janela principal
aparecer, ele checa as releases do `nipscernlab/sapho` em silêncio. Havendo
atualização, abre uma janela própria com o changelog bilíngue, nunca um diálogo
nativo. O download é incremental e tem barra de progresso real, e a instalação
acontece ao fechar o aplicativo.

## O que este estudo não cobre

Não li o CSS a fundo, então não tenho opinião fundamentada sobre o sistema de
estilos além do que o estudo de achados já registra.

Não exercitei nenhum provedor de IA de verdade, nem antes nem depois da migração
para a geração 7 do SDK, então a seção da Aurora Intelligence descreve a
arquitetura e não o comportamento observado. Vale o mesmo para o PyLibs e para o
painel de git, que têm testes unitários mas nenhuma verificação de ponta a ponta.

Não verifiquei o desenho na tela do GTKWave nem do Surfer. Está provado que os
executáveis sobem e que os arquivos de configuração são gerados; se o que aparece
está correto continua sendo teste manual, e isso é limite do método, não descuido.

Não estudei o compilador em si. O `yanc` mora em outro repositório e o que existe
aqui é a integração, não a linguagem.
