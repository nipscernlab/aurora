# Estudo — processadores SAPHO escritos em C++ (04/08/2026)

> Estudo dedicado, gerado por análise dos dois repositórios reais (`aurora` e `yanc`) em 04/08/2026.
> Nada aqui foi implementado ainda. O backlog do projeto é o
> [TODO.md](../TODO.md), que é o único; este arquivo é a fonte
> de verdade do tema C++ e é referenciado de lá, na seção 7.
>
> Duas restrições de projeto valem para tudo que está descrito abaixo, e foram incorporadas ao
> desenho: toda capacidade nova nasce como API antes de virar botão, de modo que a Aurora
> Intelligence consiga fazer tudo que o usuário faz pela interface; e a criação de processadores
> ganha painel próprio para C++, não um checkbox escondido no painel existente.

---

## 1. Resumo executivo

Criar processadores SAPHO a partir de fonte C++ não é uma capacidade a inventar. O compilador já a
tem, madura e testada. O que falta está inteiramente do lado da AURORA, mais uma dívida de paridade
de biblioteca no yanc.

No yanc existem dois binários de front-end C++, o `cpppp` (preprocessador próprio) e o `cppcomp`
(compilador flex + bison), construídos pelo mesmo Makefile que produz o cmmcomp. São 66 testes de
regressão rodando como fase própria dentro do `regress.sh`, e um pipeline de ponta a ponta em
`Scripts/single_proc_cpp.sh`. O `cppcomp` emite `Software/<proc>.asm` e `cmm_log.txt` no mesmo
formato que o cmmcomp, de forma que appcomp, asmcomp, HDL, iverilog, Verilator, GTKWave e Surfer
seguem sem uma linha de mudança.

Na AURORA, os dois binários já são distribuídos em [components/bin/](../components/bin/) e os
headers C++ já estão em [components/Header/](../components/Header/). A infraestrutura de
empacotamento foi feita e parou antes da integração. Nenhum builder, nenhum step, nenhuma entrada
no allowlist, nenhuma API, nenhum painel.

O esforço se divide em três fases. A primeira é só AURORA e entrega compilar `.cpp` até o `.v` pelo
mesmo caminho do C±, com API e ferramenta de IA desde o primeiro commit. A segunda entrega o painel
de criação de processadores C++ e a paridade de experiência. A terceira, no yanc, fecha a paridade
de linguagem, que hoje é o único limite técnico de verdade.

---

## 2. O que já existe no yanc

### 2.1 Os dois binários

O front-end C++ é composto por dois programas, e essa é a primeira diferença estrutural em relação
ao C±, que tem um só.

O `cpppp` (`Compilers/CPPComp/Sources/cpppp.c`, cerca de 30 KB) é um preprocessador escrito à mão.
Resolve `#include` com caminhos de busca passados por `-I`, `#define` com e sem parâmetros,
condicionais `#if`/`#ifdef`/`#else`/`#endif`, e `#pragma once` (que ele consome, marcando o arquivo
canônico para não reincluir). Diretivas `#pragma yanc` passam adiante literalmente, porque quem as
interpreta é o compilador. A linha de comando é `cpppp -i <in.cpp> [-o <out.cpp>] [-I <dir>]*`.

O `cppcomp` (`Compilers/CPPComp/Sources/`, com `CPPComp.y` de 104 KB e `codegen.c` de 150 KB) é o
compilador propriamente dito, gerado por bison e flex, com tabela de símbolos, sistema de tipos e
gerador de código para a ISA SAPHO. A linha de comando é
`cppcomp -i <in.cpp> -p <proc_dir> [-n <prname>] [-t <tmp>]`, deliberadamente próxima da do cmmcomp.

Ambos entram no `Makefile` do yanc como alvos de primeira classe (`make cpppp`, `make cppcomp`) e
são copiados pelo `make install` junto com os outros cinco binários.

### 2.2 Cobertura de linguagem

O `cppcomp` não é um C com classes. Os 66 testes cobrem, por leitura direta dos fontes de teste:

classes com dados e métodos, herança simples, polimorfismo com vptr no offset zero, construtores e
destrutores com RAII e destruição em ordem reversa ao sair de escopo, destrutor virtual acionado por
`delete` sobre ponteiro de base, templates de função e de classe com monomorfização real (uma função
concreta instanciada por tipo), parâmetros de template não-tipo, lambdas incluindo IIFE como
inicializador global, sobrecarga de operadores (`operator+`, `operator==`, `operator[]`),
construtor de cópia e cópia por membro, `new`/`new[]`/`delete` com heap e lista livre,
`enum class`, namespaces com `using`, `constexpr` tratado como `const` para armazenamento, membros
`static` e `static constexpr` de classe, argumentos default, protótipos em classe com definição
fora dela, métodos estáticos, ponteiros para função dentro de struct, e `noexcept` aceito e ignorado
(o alvo não tem exceções).

Há um subconjunto de STL empacotado em `Compilers/CPPComp/Includes`, replicado na AURORA em
`components/Header`: `array`, `vector`, `bit`, `cmath`, `cstddef`, `cstdint`, `cstring`, `limits`.
O `std::vector<T>` é real, com crescimento no push e `operator[]`; o `std::array<T,N>` usa o mesmo
mecanismo de parâmetro não-tipo; há um `unique_ptr` de posse com RAII.

Uma parte relevante dos testes (do `test23` ao `test32`, mais `test58` a `test60`) são exemplos
embarcados realistas e não sintéticos: framer de pacotes sobre stream de bytes, escalonador
cooperativo de tarefas, classificador de comandos estilo UART, aritmética de ponto fixo Q8.8,
registrador de status de dispositivo acessado como bitfield ou como palavra, vetor 3D para
física/IMU, máquina de estados orientada a objetos, buffer dinâmico com RAII, container de tamanho
fixo parametrizado, avaliador aritmético por descida recursiva, enlace de telemetria com CRC-16/CCITT
XModem, e entrada digital com debounce e contagem de borda.

### 2.3 Parâmetros de hardware

Onde o C± usa diretivas `#DIRETIVA valor` no cabeçalho, o C++ usa `#pragma yanc <chave> <valor>`,
lidas no lexer (`CPPComp.l`, regra por volta da linha 115). As chaves reconhecidas são `prname`,
`nubits`, `nbmant`, `nbexpo`, `nugain`, `ndstac`, `sdepth`, `nuioin`, `nuioou`, `fftsiz` e `itradd`.
Chave desconhecida gera aviso, não erro.

Sem nenhum pragma, valem os defaults de compilação em `Compilers/CPPComp/Headers/config.h`, que
descrevem o alvo YANC padrão: palavra de 32 bits, mantissa de 23, expoente de 8, ganho 128, pilhas
de dados e de retorno com 128 níveis, uma porta de entrada e uma de saída, FFT de tamanho 3. O
comentário do arquivo é explícito ao dizer que o default de build é o alvo, porque fontes C++ não
carregam diretiva de alvo obrigatória.

### 2.4 Ausências conhecidas no yanc

Três, e é importante registrá-las com precisão porque delimitam o que a Fase 1 consegue entregar.

Builtins. O `cppcomp` reconhece apenas `in()` e `out()`. Não há `fin()` nem `fout()` para entrada e
saída em ponto flutuante, e não há nada da stdlib matemática do C±. O `<cmath>` empacotado tem
somente `fabs`, `sqrt` (Newton-Raphson por software, 24 iterações fixas), e os predicados
`isfinite`/`isnan`/`isinf` que devolvem constantes porque o float YANC não tem NaN nem infinito. Não
existem `sin`, `cos`, `tan`, `exp`, `log`, `atan` nem `pow`, que em C± vêm das macros assembly
dedicadas de [components/Macros/](../components/Macros/) (`float_sin.asm`, `float_exp.asm`,
`float_log.asm`, `float_atan.asm`, `float_tan.asm`, `float_sqrt.asm`). Também não há nada de números
complexos: nem `real`, `imag`, `fase`, `mod2`, `complex`, nem a notação de Dirac que o C± suporta.

Marcadores de depuração. `#TOAQUI` e `#PRACA` não existem no `cppcomp` (busca por `toaqui`, `praca`
e `cheguei` nos fontes de CPPComp não retorna nada). O `#TOAQUI` é o que faz o pino `cheguei` virar
porta do `<proc>.v`, e é dele que depende o harness do botão Verilator da AURORA para detectar o fim
do programa.

Rastreamento de linha. O `cpppp` não emite diretivas `#line`, e o `cppcomp` descarta `#line` quando
encontra uma (`CPPComp.l`, regra logo após o bloco de pragma). Como o `cppcomp` lê o `pp.cpp`
expandido e não o `.cpp` original, a linha reportada num erro é a linha do temporário. Sem `#include`
elas coincidem por acaso; com `#include` elas deslocam pelo tamanho de tudo que foi incluído.

### 2.5 O pipeline de referência

`Scripts/single_proc_cpp.sh` é a especificação executável de como se compila um processador C++, e
deve ser tratada como tal ao implementar o builder. A sequência, com os caminhos já normalizados
para o vocabulário da AURORA:

```
cpppp   -i <proc>/Software/<base>.cpp  -o Temp/<proc>/pp.cpp
        -I components/Header  -I <proc>/Software
cppcomp -i Temp/<proc>/pp.cpp  -p <proj>/<proc>  -n <proc>  -t Temp/<proc>
appcomp -i <proc>/Software/<base>.asm  -t Temp/<proc>
asmcomp -i <proc>/Software/<base>.asm  -p <proj>/<proc>  -d components/HDL
        -m components/Macros  -t Temp/<proc>  -f <clk>  -c <numClocks>
```

Do `appcomp` em diante é byte a byte o que a AURORA já faz para C±.

---

## 3. Comparação dos dois caminhos

| | C± (hoje) | C++ (proposto) |
|---|---|---|
| Extensão | `.cmm` | `.cpp` |
| Passos de front-end | 1 (`cmmcomp`) | 2 (`cpppp` → `cppcomp`) |
| Entrada do compilador | o próprio `.cmm` | o `pp.cpp` em `Temp/<proc>/` |
| Parâmetros de HW | `#NUBITS 32` | `#pragma yanc nubits 32` |
| Flag de idioma | `-pt` / `-en` | não existe (mensagens só em inglês) |
| Flag de arrays | `-A` | não existe |
| Include path | não se aplica | `-I components/Header -I <proc>/Software` |
| Saída | `Software/<base>.asm` + `cmm_log.txt` | idêntica |
| Do appcomp em diante | igual | igual |
| Matemática de float | macros asm (sin/cos/exp/log/atan/sqrt) | só `fabs` e `sqrt` por software |
| Complexos | sim, com notação de Dirac | não |
| `#TOAQUI` / `#PRACA` | sim | não |

Duas assimetrias merecem decisão explícita antes de codar. A ausência de `-pt`/`-en` significa que o
terminal do passo C++ mostrará mensagens sempre em inglês, mesmo com a IDE em português; ou se aceita
isso na Fase 1 e se registra como dívida do yanc, ou se adia o passo até o `cppcomp` ganhar
`parse_lang_flag`. Recomendo aceitar. A ausência de `-A` significa que o campo `showArrays` do `.spf`
simplesmente não se aplica a processadores C++, e o painel deve escondê-lo em vez de mostrá-lo
inerte.

---

## 4. Inventário de gaps na AURORA

Seis pontos, todos localizados, com arquivo e linha.

Não existe builder. [js/compilation/builders/](../js/compilation/builders/) tem `asm`, `cmm`,
`cocotb`, `iverilog`, `verilator`, `vvp`, `wave_tools` e `yosys`, e nenhum `cpp`. Falta um `cpp.ts`
exportando dois construtores de spec, um para o `cpppp` e outro para o `cppcomp`, no molde exato de
[cmm.ts](../js/compilation/builders/cmm.ts), mais o reexport em `builders/index.ts`.

O allowlist não conhece os binários. [main/compile/binary_allowlist.js:37](../main/compile/binary_allowlist.js#L37)
lista `cmmcomp.exe`, `appcomp.exe`, `asmcomp.exe` e `comp2gtkw.exe` sob `bin`, e não lista
`cpppp.exe` nem `cppcomp.exe`, embora ambos estejam fisicamente em `components/bin`. Sem as duas
entradas o spawn é recusado pelo gate. É uma linha cada, e é o primeiro item de qualquer
implementação porque nada mais funciona sem ele.

A fábrica de specs só conhece o passo `cmm`. [js/compilation/spec_factory.ts:136](../js/compilation/spec_factory.ts#L136)
ramifica em `step === 'cmm'` e em `'asm-pre' | 'asm'`. Precisa de um ramo `'cpp-pp' | 'cpp'`. E nas
linhas 141 e 162 o nome base é derivado com `replace(/\.cmm$/i, '')`, que precisa virar uma remoção
de extensão genérica, sob pena de um `proc.cpp` gerar base `proc.cpp` e um `.asm` chamado
`proc.cpp.asm`.

O compilador de processador é escrito em `.cmm`. [js/compilation/processor_compiler.js:135](../js/compilation/processor_compiler.js#L135)
tem `cmmCompilation` com o nome do arquivo, o terminal e a extensão embutidos; e
[js/compilation/compilation_flow.js](../js/compilation/compilation_flow.js) mantém `STEP_TERMINALS`,
`STEP_CLEARS`, o `resolveFallbackCmmPath` (linha 171) e o `handleCmmStep` (linha 398) todos
ancorados em `.cmm`, inclusive na mensagem de erro quando não há `.cmm` em foco.

A file tree não classifica `.cpp` como software. [js/project/file_mode.js:86](../js/project/file_mode.js#L86)
declara `SOFTWARE_EXTENSIONS = ['.cmm']`. Um `.cpp` dentro de `<proc>/Software/` cairia na árvore
como arquivo genérico, fora do agrupamento do processador. Junto,
[js/editor/document_type_detector.js](../js/editor/document_type_detector.js) não mapeia `.cpp` para
o tipo de projeto de processador, e o filtro de diálogo de arquivo (linha 101) oferece só CMM,
Verilog e Python.

O `.spf` carrega o campo com a extensão no nome. O campo por processador chama `cmmFile`
(declarado em [spec_factory.ts:40](../js/compilation/spec_factory.ts#L40) e persistido pelo
[main/ipc/project.js](../main/ipc/project.js)), e o default é `${proc.name}.cmm`. A recomendação é
manter o nome do campo por compatibilidade e acrescentar um campo irmão `language` com valores
`cmm` e `cpp`, derivável da extensão quando ausente. Renomear campo persistido custa migração e não
paga nesta fase.

---

## 5. Princípio de arquitetura: a API vem primeiro

Esta é a restrição mais importante do estudo, e ela muda a ordem de implementação, não só o
resultado. Nada de C++ deve existir como comportamento exclusivo de botão. Cada capacidade nasce em
[js/api/aurora_api.js](../js/api/aurora_api.js), é exposta como ferramenta em
[main/ai/tools.js](../main/ai/tools.js), aparece no
[main/ai/aurora_mcp_server.js](../main/ai/aurora_mcp_server.js), e só então ganha interface. O painel
de criação de processadores C++ deve chamar `AuroraAPI.project.createProcessor(...)` exatamente como
a IA chamaria, sem atalho por IPC.

A consequência prática de valor é que a Aurora Intelligence passa a poder criar um processador C++,
escrever o fonte, compilar, ler o terminal, inspecionar o `.asm` gerado e simular, sozinha, num
único encadeamento de ferramentas. Hoje ela faz isso para C±; a paridade é o objetivo.

### 5.1 Superfície de API a acrescentar

No namespace `project`:

`createProcessor(config)` ganha o campo `language` (`'cmm'` por default, aceita `'cpp'`), e passa a
aceitar os parâmetros de hardware já existentes independentemente da linguagem escolhida. A API já
está em [aurora_api.js:1196](../js/api/aurora_api.js#L1196) e recebe o config inteiro por spread até
o `create-processor-project` do main, então a mudança é aditiva.

`getProcessorConfig(processorName)` ([aurora_api.js:1692](../js/api/aurora_api.js#L1692)) passa a
devolver `language` e `sourceFile`, para que a IA saiba com o que está lidando antes de escrever
código.

`setProcessorSource({ processorName, sourceFile })`, novo, troca o fonte canônico de um processador,
inferindo a linguagem da extensão. É o que permite migrar um processador de C± para C++ sem editar
o `.spf` na mão.

`listProcessors()` ([aurora_api.js:1071](../js/api/aurora_api.js#L1071)) passa a incluir `language`
em cada entrada.

No namespace `compile`:

`compileStep(step)` ([aurora_api.js:1867](../js/api/aurora_api.js#L1867)) aceita `'cpp'`, que roda
`cpppp` mais `cppcomp` mais `appcomp` mais `asmcomp`, espelhando o que o `'cmm'` faz hoje. A
granularidade de rodar só o preprocessador fica disponível por `inspectCommand`, sem virar step
próprio, para não inflar o enum visível ao usuário.

`compileAll()` passa a despachar por linguagem do processador, o que torna um projeto misto (uns
processadores em C±, outros em C++) compilável num clique só. Isso é uma consequência barata do
desenho e vale registrar como requisito, não como bônus.

`listSteps()`, `inspectCommand(step, proc)`, `previewCommand`, `listOverrides`, `setOverride`,
`listProtectedFlags` e `listAllowedBinaries` (linhas 1924 a 2025) precisam todos reconhecer os novos
passos, porque é por eles que a IA audita e ajusta a linha de comando real. O `listAllowedBinaries`
em particular passa a listar `cpppp.exe` e `cppcomp.exe` assim que o allowlist mudar.

No namespace `rules`:

Hoje `listDirectives` e `getDirective` ([aurora_api.js:2560](../js/api/aurora_api.js#L2560)) leem
`resources/sapho_rules.json`, que descreve as diretivas `#NUBITS` do C±. Falta o equivalente C++.
A proposta é acrescentar `listPragmas()` e `getPragma(name)` lendo uma seção nova `pragmas` do mesmo
JSON, mapeando cada `#pragma yanc <chave>` para a diretiva C± correspondente e para o default de
`config.h`. Sem isso a IA escreverá cabeçalhos C++ por analogia e vai errar, porque a grafia muda
de `#NUBITS 32` para `#pragma yanc nubits 32`.

Também vale expor `getCppStdlib()`, devolvendo o que cada header empacotado oferece de fato. É a
defesa direta contra a IA gerar `std::sin` confiante e o compilador reprovar.

### 5.2 Ferramentas de IA a acrescentar

Em [main/ai/tools.js](../main/ai/tools.js), seguindo o formato `{ name, description, access, api,
argStyle, inputSchema }` já usado:

`create_processor` ([tools.js:533](../main/ai/tools.js#L533)) ganha `language` no `inputSchema`, com
enum `['cmm','cpp']` e default `cmm`, e a descrição precisa dizer o que muda entre as duas, porque a
descrição é literalmente o que o modelo lê para decidir.

`compile_step` ([tools.js:417](../main/ai/tools.js#L417)) tem `'cpp'` acrescentado aos dois enums
(o do `run_in_background` na linha 410 e o próprio na linha 429), com a descrição explicando que
`cpp` roda o preprocessador antes do compilador.

`list_pragmas` e `get_pragma`, novos, no molde de `list_directives`/`get_directive`
([tools.js:122](../main/ai/tools.js#L122)), acesso `read`.

`get_cpp_stdlib`, novo, acesso `read`, listando os headers de `components/Header` e o que cada um
expõe.

`set_processor_source`, novo, acesso `write`, para a troca de linguagem de um processador existente.

### 5.3 System prompt

[js/ai/system_prompt.js](../js/ai/system_prompt.js) descreve hoje o SAPHO como um fluxo `.cmm`. Ele
precisa ganhar um parágrafo sobre o caminho C++, e mais importante, sobre os limites: sem
transcendentais, sem complexos, sem `fin`/`fout`, sem `#TOAQUI`. Um modelo que não sabe disso vai
gerar código que compila mal e desperdiçar o ciclo do usuário. O mesmo texto precisa chegar ao
`sapho_rules.json` publicado, conforme o procedimento de sincronização já registrado na memória do
projeto.

---

## 6. Painel de criação de processadores C++

### 6.1 O que existe hoje

O Processor Hub ([js/processors/processor_hub.js](../js/processors/processor_hub.js), 320 linhas de
`processor_config_panel.js` ao lado) é um formulário com nove campos: nome, nBits, gain, mantissa,
expoente, pilha de instruções, pilha de dados, portas de entrada e portas de saída. Valida em tempo
real com borda vermelha, e no submit chama `electronAPI.createProcessorProject`.

Do outro lado, o handler `create-processor-project`
([main/ipc/project.js:460](../main/ipc/project.js#L460)) valida o nome contra travessia de caminho,
cria as três pastas (`Software`, `Hardware`, `Simulation`), escreve um `.cmm` com o cabeçalho de
diretivas preenchido a partir do formulário e um `main()` vazio com um comentário de boas-vindas,
registra o processador no `.spf` e emite `processor:created`.

### 6.2 O que muda

A decisão de projeto é ter um painel de criação C++ próprio, não um seletor de linguagem enfiado no
painel atual. Os dois compartilham os nove campos de hardware, mas divergem no que oferecem além
deles, e misturar as duas coisas produz um formulário com campos que às vezes se aplicam e às vezes
não. Concretamente, C++ não tem `showArrays` e não tem flag de idioma, e ganha em troca escolhas que
o C± não tem: qual template inicial usar, e se o esqueleto já inclui headers da STL empacotada.

O caminho recomendado é extrair a validação e os nove campos de hardware para um módulo comum,
e ter dois painéis finos por cima, um por linguagem, escolhidos por uma pergunta única na abertura
ou por dois itens distintos no menu. Isso mantém a validação com um dono só e deixa cada painel
livre para divergir.

Os campos específicos do painel C++ propostos são o template inicial (mínimo, classe única, ou
máquina de estados, correspondendo a esqueletos que já existem em espírito nos testes do yanc), e
uma escolha de headers a pré-incluir entre os oito de `components/Header`. Ambos são conveniência
pura; nenhum muda o hardware gerado.

### 6.3 Template C++ gerado

O equivalente ao `.cmm` que o handler escreve hoje, com as diretivas traduzidas para pragmas:

```cpp
#pragma yanc prname <nome>
#pragma yanc nubits <nBits>
#pragma yanc ndstac <dataStackSize>
#pragma yanc sdepth <instructionStackSize>
#pragma yanc nuioin <inputPorts>
#pragma yanc nuioou <outputPorts>
#pragma yanc nbmant <nbMantissa>
#pragma yanc nbexpo <nbExponent>
#pragma yanc nugain <gain>

void main()
{
    // Øk. Você criou um processador em C++, mas e agora?
}
```

Vale manter a mesma frase de boas-vindas do template C± trocando a linguagem, porque é marca da
ferramenta e o paralelismo é intencional.

Uma armadilha a registrar: `parseCmmHeader` em
[main/ipc/project.js:555](../main/ipc/project.js#L555) lê os parâmetros de hardware de volta do
`.cmm` procurando linhas `#DIRETIVA valor`. Um processador C++ precisa do parser irmão que leia
`#pragma yanc <chave> <valor>`, senão o painel de configuração vai mostrar valores em branco ou
default para processadores C++ existentes. O mesmo vale para o renomeador, que hoje corrige a
diretiva `#PRNAME` dentro do `.cmm` ([project.js:778](../main/ipc/project.js#L778)) e precisará
corrigir `#pragma yanc prname` no `.cpp`.

---

## 7. Paridade de linguagem pendente no yanc

Esta é a fase mais cara e a única fora do repositório da AURORA. Está listada em ordem de valor por
custo.

Marcadores de depuração primeiro, porque é o que desbloqueia um botão inteiro da IDE. Acrescentar
`#pragma yanc toaqui` ao `cppcomp` com a mesma semântica do `#TOAQUI` do C± faz o pino `cheguei`
voltar a existir, e com ele o botão Verilator passa a funcionar para processadores C++. O
`ensureChegueiToaqui` da AURORA
([processor_compiler.js:93](../js/compilation/processor_compiler.js#L93)) já é idempotente e só
precisa saber inserir a forma pragma quando o fonte for `.cpp`. `#PRACA` segue a mesma lógica.

Entrada e saída em ponto flutuante depois. `fin()` e `fout()` são builtins de uma linha cada no
gerador de código, e a ausência deles obriga o usuário a fazer conversões manuais que o C± resolve
sozinho.

A ponte da matemática de float em seguida. As macros `float_*.asm` já existem e já são passadas ao
asmcomp por `-m`; o que falta é o `cppcomp` emitir as chamadas correspondentes quando vê
`std::sin` e companhia. O `<cmath>` empacotado passaria a ser uma casca fina sobre as macros, em vez
de implementação por software, e o `sqrt` atual de 24 iterações Newton-Raphson seria substituído
pela macro dedicada, com ganho de tamanho e de ciclos.

Rastreamento de linha por último, por ser o de menor impacto funcional e maior chateação de
implementação. O `cpppp` emitindo `#line` e o `cppcomp` respeitando-o em vez de descartar faz os
erros apontarem para o `.cpp` do usuário, e faz o clique de "linha N" no terminal da AURORA abrir o
lugar certo. Enquanto isso não existe, a AURORA deve exibir um aviso no terminal do passo C++ quando
o fonte contiver `#include`, dizendo que os números de linha são do arquivo expandido.

Números complexos e notação de Dirac ficam fora de escopo declarado. É trabalho de gramática e de
tipos comparável ao que já se fez no C±, e nenhum caso de uso atual pede complexos em C++.

---

## 8. Plano de execução

### Fase 1 — pipeline C++ funcionando, só AURORA

Ordem importa: o allowlist é primeiro porque sem ele nada roda, e a API vem antes da interface por
princípio.

- [ ] `cpppp.exe` e `cppcomp.exe` no [binary_allowlist.js](../main/compile/binary_allowlist.js) sob `bin`
- [ ] `js/compilation/builders/cpp.ts` com `buildCppPpSpec` e `buildCppSpec`, no molde de `cmm.ts`
- [ ] reexport em `builders/index.ts`
- [ ] ramo `'cpp-pp' | 'cpp'` em [spec_factory.ts](../js/compilation/spec_factory.ts), e remoção de extensão genérica no lugar do `replace(/\.cmm$/i, '')` das linhas 141 e 162
- [ ] campo `language` no `.spf` por processador, derivado da extensão quando ausente
- [ ] `cppCompilation` em [processor_compiler.js](../js/compilation/processor_compiler.js), irmão de `cmmCompilation`
- [ ] despacho por linguagem em [compilation_flow.js](../js/compilation/compilation_flow.js): `handleCmmStep`, `resolveFallbackCmmPath`, `precompileAllProcessors`, `STEP_TERMINALS`, `STEP_CLEARS`
- [ ] `SOFTWARE_EXTENSIONS` em [file_mode.js:86](../js/project/file_mode.js#L86) aceitando `.cpp`
- [ ] `.cpp` em [document_type_detector.js](../js/editor/document_type_detector.js) e nos filtros de diálogo
- [ ] `compile.compileStep('cpp')` e despacho por linguagem em `compileAll()` na [aurora_api.js](../js/api/aurora_api.js)
- [ ] `'cpp'` nos enums de `compile_step` e `run_in_background` em [tools.js](../main/ai/tools.js)
- [ ] `listSteps`, `inspectCommand`, `previewCommand` e overrides reconhecendo os passos novos
- [ ] aviso no terminal quando o fonte tiver `#include` (números de linha do arquivo expandido)

Entregável verificável: abrir um `.cpp` num `<proc>/Software/`, clicar no botão de compilar, obter
`Hardware/<proc>.v` e os `.mif`, e a IA conseguir fazer o mesmo por `compile_step("cpp")`.

### Fase 2 — painel, API completa e experiência

- [ ] extrair validação e os nove campos de hardware do [processor_hub.js](../js/processors/processor_hub.js) para módulo comum
- [ ] painel de criação de processador C++ por cima do módulo comum, com template e headers
- [ ] template `.cpp` com pragmas no handler `create-processor-project` de [main/ipc/project.js](../main/ipc/project.js)
- [ ] parser irmão do `parseCmmHeader` para `#pragma yanc` ([project.js:555](../main/ipc/project.js#L555))
- [ ] renomeador corrigindo `#pragma yanc prname` no `.cpp` ([project.js:778](../main/ipc/project.js#L778))
- [ ] `language` em `createProcessor`, `getProcessorConfig` e `listProcessors` na API
- [ ] `setProcessorSource` novo na API, e `set_processor_source` em tools.js
- [ ] seção `pragmas` no `resources/sapho_rules.json`, mais `rules.listPragmas`/`getPragma` e as tools `list_pragmas`/`get_pragma`
- [ ] `rules.getCppStdlib` e a tool `get_cpp_stdlib`
- [ ] parágrafo C++ no [system_prompt.js](../js/ai/system_prompt.js), com os limites declarados
- [ ] ícone de `.cpp` na file tree ([material_icons.js](../js/tree/material_icons.js))
- [ ] `showArrays` escondido para processadores C++ no painel de configuração

Entregável verificável: criar um processador C++ pelo painel e pela IA, com o mesmo resultado em
disco, e um projeto misto compilando num clique.

### Fase 3 — paridade de linguagem, no yanc

- [ ] `#pragma yanc toaqui` e `praca` no `cppcomp`, e `ensureChegueiToaqui` da AURORA emitindo a forma pragma
- [ ] builtins `fin()` e `fout()` no `cppcomp`
- [ ] `<cmath>` como casca sobre as macros `float_*.asm`, substituindo o `sqrt` por software
- [ ] `#line` emitido pelo `cpppp` e respeitado pelo `cppcomp`
- [ ] testes de regressão novos no `regress.sh` cobrindo cada item acima

Fora de escopo declarado: números complexos e notação de Dirac em C++.

---

## 9. Riscos e decisões em aberto

Mensagens do `cppcomp` só em inglês, porque não há `-pt`/`-en`. Recomendo aceitar na Fase 1 e tratar
como dívida do yanc, sinalizando no terminal que aquele passo não é traduzido.

Números de linha sobre o arquivo expandido enquanto não houver `#line`. O aviso no terminal cobre o
caso, mas é experiência degradada em relação ao C± e precisa ser dito ao usuário, não escondido.

O campo `cmmFile` do `.spf` mantendo o nome enquanto aponta para um `.cpp` é dissonante e vai
confundir quem ler o arquivo. A alternativa, renomear para `sourceFile` com migração automática na
abertura de projeto, é mais limpa e custa um bloco de migração no `spf_store`. Vale decidir antes da
Fase 1, porque depois o custo cresce com a base de projetos.

Um processador C++ hoje não roda no botão Verilator por falta de `#TOAQUI`. Até a Fase 3, o botão
deve ficar desabilitado com explicação para processadores C++, e não falhar silenciosamente.

A ausência de transcendentais é o limite real de aplicabilidade. Processadores de controle, de
protocolo, de máquina de estados e de aritmética inteira ou de ponto fixo cabem hoje em C++.
Processadores de DSP com seno, exponencial ou complexos continuam sendo território exclusivo do C±
até a Fase 3.

---

## 10. Testes

O yanc já tem a fase CPP no `regress.sh` com 66 casos, e ela não precisa mudar.

Do lado da AURORA, o que precisa nascer com a Fase 1 são testes de unidade sobre o builder novo
(spec correto, argumentos na ordem, caminhos resolvidos), sobre a derivação de linguagem a partir da
extensão, e sobre o despacho por linguagem no `compileAll`. O padrão de teste da casa já cobre os
builders existentes, então é extensão e não invenção.

Um teste ponta a ponta compilando o `proc_cpp` do yanc dentro de um projeto AURORA fecharia a
verificação da Fase 1 com custo baixo, porque o fonte já existe e o resultado esperado é conhecido.

---

## 11. Referências de arquivo

Do lado da AURORA: [builders/](../js/compilation/builders/),
[spec_factory.ts](../js/compilation/spec_factory.ts),
[processor_compiler.js](../js/compilation/processor_compiler.js),
[compilation_flow.js](../js/compilation/compilation_flow.js),
[binary_allowlist.js](../main/compile/binary_allowlist.js),
[file_mode.js](../js/project/file_mode.js),
[document_type_detector.js](../js/editor/document_type_detector.js),
[aurora_api.js](../js/api/aurora_api.js), [tools.js](../main/ai/tools.js),
[aurora_mcp_server.js](../main/ai/aurora_mcp_server.js),
[processor_hub.js](../js/processors/processor_hub.js),
[main/ipc/project.js](../main/ipc/project.js),
[components/bin/](../components/bin/), [components/Header/](../components/Header/),
[components/Macros/](../components/Macros/).

Do lado do yanc, fora deste repositório: `Makefile`, `Scripts/single_proc_cpp.sh`,
`Scripts/regress.sh`, `Compilers/CPPComp/Sources/cpppp.c`, `Compilers/CPPComp/Sources/CPPComp.l`,
`Compilers/CPPComp/Sources/CPPComp.y`, `Compilers/CPPComp/Sources/codegen.c`,
`Compilers/CPPComp/Headers/config.h`, `Compilers/CPPComp/Includes/`,
`Compilers/CPPComp/Tests/proc_cpp/`.
