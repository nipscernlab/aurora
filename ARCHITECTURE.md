# Invariantes do renderer

Isto não é visão geral nem documento de introdução; para isso leia o
[README.md](README.md), e para entender como a aplicação é montada leia o
[estudo do código](docs/ESTUDO_CODIGO_AURORA.md).

O que está aqui são os contratos que o renderer depende mas não impõe. Cada um
foi aprendido com alguma coisa quebrando de forma sutil. Leia antes de refatorar
qualquer coisa em [js/app/](js/app/), [js/project/](js/project/),
[js/tree/](js/tree/), [js/editor/](js/editor/), [js/tabs/](js/tabs/),
[js/wave/](js/wave/), ou os caminhos de onda em
[js/compilation/](js/compilation/).

O documento só serve enquanto for confiável, então quatro regras de manutenção.
Mudou algo coberto aqui, atualize no mesmo commit. Cite símbolos e nunca números
de linha, porque âncora de linha apodrece em silêncio e nome de função falha alto,
já que o grep não acha. Aponte para o `.ts` dos módulos migrados, não para o `.js`
compilado ao lado. E o JSDoc no código é a autoridade sobre qualquer função citada
aqui: se os dois discordarem, o JSDoc está certo e este arquivo tem um bug.

Última auditoria completa contra o código em 07/08/2026.

## 1. Ordem de carga dos scripts

Isso já foi um contrato amplo e frágil. O [index.html](index.html) carregava uma
dezena de scripts clássicos que compartilhavam estado por `window.*`, e a ordem
das tags era contrato de verdade: reordenar produzia leitura de `undefined` em
silêncio. Todos foram convertidos para módulos ES, um a um, cada um trocando seu
global por um `import` real.

Sobrou uma restrição de ordem que ainda sustenta peso. O carregador AMD do Monaco,
`node_modules/monaco-editor/min/vs/loader.js`, é o único script não modular que
resta, e precisa vir antes de qualquer tag `type="module"`. Ele instala o
`require()` global que o [monaco_editor.js](js/editor/monaco_editor.js) chama em
tempo de import; sem ele, `initMonaco()` rejeita. No [index.html](index.html) ele
é a tag `<script src=".../vs/loader.js">`, e a primeira tag `type="module"` vem
depois dela. Nunca dê `type="module"` a ele.

Para tudo que é alcançado por `import`, a ordem das tags é irrelevante, porque o
grafo é resolvido pelo bundler.

Restam duas dependências estreitas de ordem. A primeira é que ouvintes de
`DOMContentLoaded` disparam na ordem de registro, e para tags irmãs isso é a ordem
das tags. O [file_mode.js](js/project/file_mode.js) e o
[app_initializer.js](js/app/app_initializer.js) registram um ouvinte cada em tempo
de avaliação, e o `file_mode` precisa vir antes, porque os dois tocam `activateTree`
no mesmo tique. Isso não é expressável por import. A segunda é que três módulos
ainda publicam em `window.*` na avaliação, `window.appInitializer`,
`window.projectTreeManager` e `window.SharedModelRegistry`, para consumidores que
os leem por nome. Enquanto essas leituras acontecerem dentro de manipuladores, a
ordem não importa; se você acrescentar uma leitura em tempo de avaliação, o
contrato de ordem volta. Prefira converter o consumidor para `import`.

## 2. Cada conceito tem um dono só

Divergência entre várias fontes da verdade causou vários bugs em 2026. Hoje cada
estado transversal tem exatamente um dono.

| Conceito | Dono | Como os outros leem |
|---|---|---|
| Projeto atual (caminho e spf) | [`ProjectStore`](js/project/project_store.js) | `getProjectPath()` e `getSpfPath()`, espelhados em `window.currentProjectPath` e `window.currentSpfPath` para leituras legadas |
| Abas abertas | `TabManager.tabs` ([tab_manager.js](js/tabs/tab_manager.js)) | `TabManager.tabs.get(filePath)` |
| Instâncias do Monaco | `EditorManager.editors` ([monaco_editor.js](js/editor/monaco_editor.js)) | `EditorManager.getEditorForFile(filePath)` |
| Modelos de texto compartilhados | `SharedModelRegistry` ([shared_models.js](js/editor/shared_models.js)) | `SharedModelRegistry.getModel(filePath)` |
| Estado da árvore Verilog | `ProjectTreeManager` ([file_mode.js](js/project/file_mode.js)) | não leia de fora; chame os métodos |
| Estado de onda por testbench | `WaveStore` ([wave_state_store.ts](js/wave/wave_state_store.ts)) | `WaveStore.read/get(projectPath, tbKey)` |

Se você se pegar cacheando um desses em `this.*`, está recriando o bug. Leia do
dono. E o dono precisa expor `reset()` ou `clearProject()` explícito, em vez de
deixar código externo mutar campos; o [close_project.js](js/project/close_project.js)
é o padrão.

## 3. Recursos com escritor único

Alguns recursos compartilhados têm um escritor designado, e os outros pontos de
chamada não devem escrever neles nem quando seria conveniente.

Instâncias do Monaco só são criadas pelo bloco que espera `EditorManager.ready`
dentro de `TabManager.addTab`. Um atalho de criação automática dentro de
`setActiveEditor` correndo contra esse caminho produzia dois divs de editor
empilhados compartilhando o mesmo modelo, e o usuário via artefatos e não
conseguia digitar.

`window.currentProjectPath` e `window.currentSpfPath` só são escritos por
`ProjectStore.setProject` e `clearProject`. Vários escritores divergem, e o
descompasso entre cache e estado vivo causava o bug de arquivo fora da pasta
sumindo ao reabrir.

Escrita no `.spf` pelo renderer passa pelo [SpfStore](js/project/spf_store.ts). O
escritor canônico é o `ProjectTreeManager`, que chama `SpfStore.update(spfPath,
mutator)`, serializando leitura, mutação e escrita por caminho e preservando o
`metadata`. Cada mutador toca só os campos que seu manager possui, e o resto vem
dos padrões do `SpfStore`, de modo que campos desconhecidos que um escritor futuro
acrescente sobrevivem ao ciclo. Se você adicionar um segundo escritor do lado do
renderer, use `update()` e não escreva o arquivo direto. O processo principal
também escreve o `.spf` em eventos de ciclo de vida, e a corrida teórica com o
renderer é aceitável porque os dois são disparados por interação sequencial.

## 4. Editor só nasce pelo addTab

Isto é importante o bastante para ter seção própria. Só o ramo de arquivo de texto
do `TabManager.addTab` chama `EditorManager.createEditorInstance`. O
`setActiveEditor` alterna entre editores existentes, mas não cria nenhum. Hoje há
exatamente uma chamada em todo o código, no `tab_manager.js`.

## 5. Sequência de arranque

A AURORA roda em modo único hoje. Existiram três modos historicamente, e o
pipeline decide sozinho entre simulação completa e apenas Verilog a partir de
`window.availableProcessors`, semeado do `.spf`.

No arranque, três manipuladores de `DOMContentLoaded` rodam em ordem. O do
`monaco_editor` carrega os módulos AMD, inicializa o `EditorManager` e libera a
promessa `ready`. O do `renderer` inicializa o `TabManager`, a árvore de arquivos e
o gerenciador de projeto. O do `app_initializer` restaura a última sessão, o que
leva ao `loadProject`, que define o projeto no `ProjectStore` e ativa a árvore.

Duas armadilhas. O `initializeTreeBasedOnMode` espera a `initPromise` do
`projectTreeManager`, que é o sinal real de prontidão, e não um tempo fixo.
Historicamente era um `setTimeout` de cem milissegundos chutado, que em arranque
frio rodava antes de a árvore existir e desistia calado. Não volte para o sono. E
os módulos AMD do Monaco carregam de forma assíncrona, então uma chamada a
`addTab` antes de `ready` resolver bloqueia no `await`: a aba aparece na hora, o
editor não.

## 6. refreshTree é o único ponto de entrada

O [file_mode.js](js/project/file_mode.js) expõe um ponto só para atualizar a
árvore, o `refreshTree()`. Ele funde chamadas concorrentes, roda a preparação de
forma idempotente e repete carga e desenho até o estado estabilizar. O
`activateTree()` sobrevive como apelido histórico e chama `refreshTree`
diretamente.

Pelo menos três caminhos podem chamá-lo no mesmo tique durante a restauração de
sessão: o `loadProject`, o `initializeTreeBasedOnMode` e o vigia de arquivos.
Antes da consolidação havia dois cadeados separados, e as duas rotinas rodavam em
paralelo, cada uma zerando `verilogFiles` e esperando entrada e saída, de modo que
o reset de uma limpava o que a outra tinha acumulado no meio da iteração,
duplicando entradas. Um cadeado só eliminou essa classe inteira.

Não chame `refreshTree` de dentro dele mesmo, e não contorne o invólucro chamando
`loadConfiguration` direto: essa função só deve ser chamada de dentro do laço do
`refreshTree`.

## 7. EditorManager.ready

O `EditorManager.ready` é uma promessa resolvida em `finally` depois que
`initMonaco()` e `EditorManager.initialize()` terminam ou falham. O
`TabManager.addTab` a espera antes de criar o editor; sem isso, um clique rápido
durante a janela de carga AMD produz "EditorManager has not been initialized",
porque o container ainda é nulo.

A promessa resolve mesmo quando a inicialização falha, porque o `finally` roda
incondicionalmente. O `createEditorInstance` se defende disso buscando o
`#monaco-editor` de novo no DOM e checando `window.monaco`; falhando os dois, ele
registra e devolve indefinido, e o `addTab` fecha a aba.

## 8. Fragilidades conhecidas

O monaco-editor precisa ser exatamente 0.52.2. A 0.53.0 lança exceção dentro do
próprio `monaco.contribution.js` durante a inicialização, o que trava o
`EditorManager.initialize()` e deixa o editor pela metade, com cursor desenhando e
digitação morta. O sintoma é intermitente, porque depende de qual módulo de
contribuição falha primeiro, e escapa de teste casual. A versão está pinada sem
acento circunflexo no [package.json](package.json) e verificada pelo
[check-pinned-versions.js](scripts/check-pinned-versions.js), que roda no
`prestart` e no CI. O mesmo script vigia automaticamente qualquer dependência que
você pinar de forma exata: basta tirar o acento. Desde 07/08/2026 o
`.github/dependabot.yml` também ignora o monaco, porque o guarda compara declarado
contra instalado e o robô subiria os dois juntos.

O `#file-tree` tem três subcontêineres de visão e um controlador só. Três visões
desenham a árvore: listagem de pastas, seletor Verilog e hierarquia de módulos. O
subsistema passou por uma cadeia de cinco bugs antes de assentar num desenho de
duas camadas que impede a classe inteira. A primeira camada são subárvores de DOM
fisicamente separadas, de modo que os desenhadores literalmente não podem colidir,
e o CSS mostra só a ativa a partir de um atributo. A segunda é um controlador
único, o [fileTreeViewController](js/tree/file_tree_view_controller.js), dono do
ouvinte do botão de alternância, do nome da visão ativa e dos dados de hierarquia.

O desenhador da visão Verilog é um reconciliador por chave, que compara
`verilogFiles` com as linhas existentes por `data-file-path` e aplica a mutação
mínima, de modo que desenhar duas vezes com o mesmo dado não mexe no DOM. Não
troque isso por destruir e reconstruir. Para acrescentar uma quarta visão, some o
nome em `VIEW_NAMES`, escreva a regra de CSS, escreva um desenhador que aponte
para o contêiner dela e registre no controlador; não introduza um escritor que
toque o `#file-tree` direto nem que ponha o próprio ouvinte no botão. Seis
tentativas anteriores usaram DOM compartilhado com cadeado de classe ou campos de
hierarquia sincronizados à mão, e cada uma fechou o bug visível deixando um canto
novo aberto.

Construtores de manager fazem entrada e saída. O `ProjectTreeManager`, o
`GtkwPickerManager` e outros chamam `this.init()` no construtor, que espera
`DOMContentLoaded`, cacheia elementos, prende ouvintes e possivelmente chama IPC.
A ordem de carga é a ordem implícita de inicialização, e mover essas chamadas é
exatamente a classe de mudança que quebra o arranque de forma sutil.

## 9. Fluxo de onda: o dump é a verdade

O princípio é um só. Qualquer coisa que peçamos ao visualizador para mostrar tem
que existir no dump que a simulação de fato produziu. O usuário pode pedir sinais
por mais de um caminho, mas o dump vence.

O orquestrador é o `runGtkWave` em
[compilation_module.js](js/compilation/compilation_module.js). Ele valida, exigindo
testbench e deixando síntese e topo opcionais, e então roda fases privadas, cada
uma com contrato próprio em JSDoc. O orquestrador é curto de propósito e documenta
só a ordem das fases. Mudança de comportamento pertence a uma fase; se você se
pegar tocando duas fases para uma funcionalidade, achou uma abstração faltando.

O fluxo tem dois eixos de ramificação, a linguagem do testbench, Verilog ou Python
com cocotb, e o simulador, Icarus por padrão ou Verilator por opção. Os quatro
caminhos convergem em `_waveResolveVcdFile`, que acha o dump produzido; se houver
um candidato com nome diferente ele adota com aviso, e se houver zero ou vários
ele lança com instrução concreta.

As fontes do que dumpar têm precedência definida, e a autoridade é o JSDoc de
`_resolveWaveSelection`. Primeiro vem o `.gtkw` ativo marcado no seletor, do qual a
AURORA extrai as referências, valida contra a hierarquia e usa. Depois vem a
Wave Configuration customizada, que dita o `$dumpvars` inclusive sobrescrevendo um
`$dumpvars` escrito à mão. Depois vem o `$dumpvars` manual do testbench, caso em
que nada é injetado. E por último o padrão, que é todo sinal no escopo do
testbench, sem descer no DUT.

Não acrescente uma quinta fonte. As quatro já formam uma cadeia de precedência com
regras de sobreposição documentadas, e cada fonte nova significa mais uma decisão
de prioridade e mais uma classe de descompasso silencioso. Não contorne o
`validateSelection` para injetar `$dumpvars` direto: se o caminho que você escrever
não estiver na hierarquia analisada, o iverilog falha com "port X is not a port of
dut", que foi exatamente o bug de quando o seletor saiu sem validação.

A precedência da configuração sobre o testbench é intencional e de mão única. A
configuração customizada sobrescreve o `$dumpvars` manual, mas um testbench com
`$dumpvars` manual e configuração não customizada fica intocado, e nunca limpamos
o estado salvo de forma proativa, porque o usuário pode reverter a customização e
querer o comportamento antigo de volta.

O cache `_validatedWaveSelection` existe porque a seleção é decidida durante a
construção, na fase de instrumentação, enquanto o arquivo de configuração do
visualizador é escrito depois, quando a simulação já produziu o dump. Os dois
passos precisam da mesma seleção já podada, então a construção escreve e o passo
seguinte lê. Sem o cache, ou se refaz a análise, ou se avisa o usuário duas vezes
sobre sinais que já foram podados.

O lado do Surfer espelha a mesma curadoria num arquivo declarativo `.surf.ron`,
com os mesmos processadores detectados, cores e apelidos, mas cada processador
vira um grupo colapsável em vez de um divisor, e os traços de Assembly e C± são
decodificados por tradutores de mapeamento. Números complexos passam por uma
etapa prévia com o `comp2gtkw.exe`, exposta como `complex_decode.ts` e o canal
`decode-complex`.

## 10. Checklist de refatoração

Antes de mergear qualquer mudança nesta camada:

- [ ] Acrescentou ou removeu um global `window.*`? Atualize a seção 2.
- [ ] Mudou a ordem de carga no [index.html](index.html)? Confira a seção 1.
- [ ] Acrescentou um escritor a um recurso de escritor único? Não faça.
- [ ] Cacheou o caminho do projeto em `this.*`? Leia do dono.
- [ ] Chamou `createEditorInstance` fora do `addTab`? Veja a seção 4.
- [ ] Reintroduziu modos diferentes? A AURORA é de modo único desde maio de 2026, e voltar atrás exige teste manual de abrir, fechar, reabrir e editar.
- [ ] Acrescentou um ouvinte de `DOMContentLoaded`? Confirme que ele não depende de ouvintes posteriores já terem rodado.
- [ ] Acrescentou um caminho que decide o que entra no `$dumpvars` ou no arquivo de configuração do visualizador? Releia a seção 9.
- [ ] Renomeou um símbolo citado aqui? Procure o nome antigo neste arquivo e nos comentários do código.
- [ ] Fixou `.cmm` num caminho de processador? Veja a seção 13.
- [ ] Acrescentou uma capacidade de processador só como botão? Veja a seção 13.
- [ ] Tocou em `name`, `productName`, `build.productName` ou `build.appId`? Releia a seção 11.
- [ ] Mudou como o resultado de um cocotb é decidido? Veja a seção 12.
- [ ] Mudou os argumentos de um passo de compilação? Rode `npm run test:toolchain`.

O teste de fumaça manual leva uns dois minutos: abrir a AURORA e ver o último
projeto carregar sozinho, clicar num `.v` e conseguir digitar, fechar e reabrir o
projeto pelos recentes e ainda conseguir editar, e alternar simulação vendo as
árvores trocarem limpo.

O automatizado roda no CI. O [smoke.test.js](tests/e2e/smoke.test.js) sobe uma
AURORA real pelo Playwright e afirma que o Monaco inicializa sem os marcadores de
falha conhecidos. O [pipeline.test.js](tests/toolchain/pipeline.test.js) dirige os
binários de verdade, levando um fonte C± a processador Verilog, elaborando,
simulando sob Icarus, Verilator e cocotb, sintetizando um esquemático e
verificando o handshake dos servidores de linguagem. Ele não faz parte do `npm
test` porque precisa da pasta `components` inteira.

## 11. Identidade do produto: quatro nomes, quatro consequências

Quatro campos escrevem o nome do produto, e cada um aterrissa em lugar diferente
do disco. Mudar qualquer um move estado que cópias já instaladas estão usando.

| Campo | Valor | O que controla |
|---|---|---|
| `package.json` `name` | `sapho` | O diretório de cache do updater, `%LOCALAPPDATA%\<name>-updater` |
| `package.json` `productName` | `SAPHO` | `app.getName()`, e portanto userData e logs em `%APPDATA%\SAPHO` |
| `build.productName` | `SAPHO` | O nome do executável, o diretório de instalação e os atalhos |
| `build.appId` | `com.nipscern.sapho` | O AppUserModelID dos atalhos e a chave de desinstalação |
| `build.win.artifactName` | `sapho-aurora-Setup-v${version}.exe` | O nome do instalador publicado |

Tudo que vira arquivo ou diretório usa `SAPHO` sozinho. "SAPHO & AURORA" é texto
de exibição apenas, porque o `&` é legal em caminho do Windows mas quebra qualquer
script que os toque sem aspas.

O `name` é o que você não pode renomear. O diretório de cache do updater deriva
dele e guarda o instalador que serve de base para o download incremental.
Renomeie o pacote e cada cópia instalada procura essa base num diretório que não
existe: sem erro, sem aviso, apenas uma queda silenciosa para o download completo
de meio gigabyte na frota inteira.

O `build.productName` move o diretório de instalação. Uma máquina instalada sob um
nome que receba uma build com outro instala ao lado da antiga, e não por cima,
deixando arquivos órfãos, atalhos duplicados e uma entrada de desinstalação velha.
Renomeie antes de implantar, nunca depois.

O `build.appId` e o `app.setAppUserModelId` precisam concordar. O
[main.js](main.js) define o identificador no arranque e o electron-builder carimba
os atalhos com o `appId`; quando divergem, o Windows trata a janela em execução e
o atalho fixado como aplicações diferentes, e o agrupamento na barra de tarefas
mais a jumplist prendem na identidade errada. Eles divergiram até 06/08/2026, que
é por que a correção da jumplist documentada no `main.js` nunca pegou por
completo.

Comentários não vão dentro do bloco `build`, porque o electron-builder valida
contra um esquema estrito e rejeita chave desconhecida, inclusive prefixada por
barras. As notas de identidade vivem no topo do `package.json`.

## 12. cocotb devolve veredito, não só código de saída

Uma testbench cocotb existe para responder uma pergunta: o projeto passou? O
`runner.test()` não codifica isso no código de saída, e devolve zero tanto quando
tudo passa quanto quando tudo falha. Checar apenas se o código é diferente de zero
reportava uma testbench reprovada como simulação bem-sucedida.

Por isso o [runner](js/compilation/cocotb_runner_source.js) lê o `results.xml` e
codifica o veredito ele mesmo. Zero significa que todos os testes passaram e segue
o caminho normal. Dois significa que a simulação completou e os testes falharam, e
aí a AURORA reporta a falha e mesmo assim abre a forma de onda. Qualquer outro
valor é falha de infraestrutura e aborta, porque não há o que mostrar.

A linha do meio é o ponto. Abortar numa falha de teste negaria ao estudante a
forma de onda no momento em que ela é mais útil. "Nenhum teste coletado" conta
como falha também, porque uma simulação que terminou sem verificar nada não pode
ler como aprovação. Se você acrescentar um quarto desfecho, ele precisa de código
próprio; reusar o um tornaria falha de teste indistinguível de build quebrado.

## 13. O front end do processador vai ser despachado por linguagem

O fonte de um processador SAPHO é um `.cmm` hoje, mas a toolchain yanc também tem
um front end C++ que converge no mesmo `.asm` e no mesmo log. Do `appcomp` em
diante o pipeline é idêntico, então a divisão fica confinada a um passo na frente.

Dois invariantes governam esse trabalho, e valem para código escrito antes de ele
chegar. O passo de front end é escolhido a partir da linguagem do fonte, não
assumido; os pontos que hoje assumem `.cmm` e vão precisar despachar são o
[spec_factory.ts](js/compilation/spec_factory.ts), o
[processor_compiler.js](js/compilation/processor_compiler.js), o
[compilation_flow.js](js/compilation/compilation_flow.js) e o
[file_mode.js](js/project/file_mode.js). Não acrescente um quinto.

E toda capacidade de processador é uma API chamável pela IA antes de ser um botão.
O caminho é [aurora_api.js](js/api/aurora_api.js), depois
[main/ai/tools.js](main/ai/tools.js), depois o MCP, e só então o painel, que chama
a mesma API que o modelo chama. Capacidade alcançável só por clique é um bug nesta
camada.

O plano completo está em
[ESTUDO_CPP_PROCESSADORES.md](docs/ESTUDO_CPP_PROCESSADORES.md).
