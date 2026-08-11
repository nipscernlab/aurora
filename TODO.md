# TODO

Guia único de implementação do projeto. Consolidado em 11/08/2026 a partir de
todos os documentos de planejamento, estudo e runbook que viviam em `docs/`, os
quais foram absorvidos aqui e removidos. Sobrevivem fora deste arquivo apenas o
README, o ARCHITECTURE (contratos do renderer), os arquivos de licença e
comunidade, a referência de ferramentas gerada pelo CI, e o manual e a
referência técnica em LaTeX, que são entregáveis publicados.

A regra é uma só: entra aqui o que não foi feito. Ao concluir, risque e apague,
porque o git guarda a história melhor do que uma lista de coisas prontas.

## Estado verificado em 11/08/2026

`main` em `bba09c6b`, CI verde, árvore limpa. Versão 6.3.2, com o PR #63
propondo a 6.4.0. Última release publicada é a v6.2.0. O instalador não é
assinado. O updater está completo no código: checagem 6 s após o boot,
re-checagem a cada 3 h, delta por blockmap, retry com backoff de 1/5/15 min e
depois de hora em hora. São 975 testes unitários, 20 E2E e 27 de toolchain.
O build publica em `nipscernlab/sapho` e espelha as release notes para lá.

O plano de deploy, na ordem: instalar num PC do LABEL, gerar a release e
testar, gerar uma segunda release e ver a atualização acontecer, e só então
implantar na frota. As seções 1 a 4 são esse plano; as demais vêm depois.

---

## 1. Release de teste e ensaio de atualização

O updater tem 12 testes de agendamento e o delta foi conferido no código, mas
ninguém nunca viu uma atualização acontecer. A promessa para o laboratório é
"instala uma vez e atualiza sem voltar presencialmente", e se ela falhar vai
falhar em 30 máquinas ao mesmo tempo, com aula acontecendo. Este ensaio é o
passo que a frota não pode ser a primeira a fazer.

- [ ] Merge do PR #63, que cria a tag v6.4.0, dispara o `release.yml` e publica
      `sapho-aurora-Setup-v6.4.0.exe` em `nipscernlab/sapho`.
- [ ] Instalar a 6.4.0 na máquina do LABEL e rodar o roteiro da seção 2.7.
- [ ] Fazer uma alteração trivial, mergear o novo PR de release, publicar a
      6.4.1.
- [ ] Abrir o app na máquina do LABEL e observar o ciclo inteiro:
  - a checagem silenciosa dispara ~6 s após o boot e a janela de atualização
    aparece com o changelog preenchido; corpo vazio significa que o
    espelhamento de release notes falhou;
  - o download é incremental, e dá para medir acompanhando os MB transferidos
    na própria janela contra os ~500 MB do instalador completo;
  - fechar o app aplica a atualização em silêncio, sem elevação, e a próxima
    abertura mostra a 6.4.1 com o toast de confirmação;
  - Configurações > Sobre > Atualizações reflete o que aconteceu.
- [ ] Resiliência, no mesmo ensaio: derrubar a rede no meio do download e
      confirmar que a janela mostra a contagem regressiva e retoma sozinha, em
      vez de congelar a barra.
- [ ] Passando tudo, liberar a implantação na frota (seção 2).

Essas duas releases saem sem assinatura, o que é esperado. A assinatura entra
depois (seção 3), e o primeiro release assinado será download completo para
todo mundo, porque a assinatura invalida os blocos do delta; depois dele volta
o incremental.

---

## 2. Implantação nos PCs do LABEL

Material para o suporte técnico. A IDE instala por usuário, sem administrador,
porque o instalador é NSIS `oneClick` sem elevação: instalar em Arquivos de
Programas exigiria consentimento de admin a cada atualização, e numa máquina
onde o aluno não é admin a atualização nunca aconteceria.

| Item | Valor |
|---|---|
| Diretório do programa | `%LOCALAPPDATA%\Programs\SAPHO\` (executável `SAPHO.exe`) |
| Dados e logs | `%APPDATA%\SAPHO\` |
| Cache do atualizador | `%LOCALAPPDATA%\sapho-updater\` |
| Toolchain | `%LOCALAPPDATA%\Programs\SAPHO\components\` |
| Disco por usuário | ~1,6 GB (≈1,1 GB instalado + ≈0,5 GB de instalador em cache) |
| Rede | HTTPS para `github.com` e `objects.githubusercontent.com`, nenhuma obrigatória para compilar |

O que costuma travar: a IDE executa compiladores a partir do perfil do usuário,
e políticas do tipo "bloquear execução fora de Arquivos de Programas" impedem o
funcionamento mesmo com a instalação bem-sucedida. Os binários são um conjunto
fechado por allowlist em [main/compile/binary_allowlist.js](main/compile/binary_allowlist.js):
compiladores SAPHO (`cmmcomp`, `appcomp`, `asmcomp`, `cppcomp`, `cpppp`),
Icarus (`iverilog`, `vvp`), Verilator com `g++`/`make`/`perl`, Yosys, GTKWave,
Python 3.12, e as ferramentas de linguagem (`verible-verilog-ls`,
`slang-server`, `clang-format`). Qualquer binário fora dela é recusado.

- [ ] **2.1 Decidir o modelo de implantação**, antes de instalar: se o perfil é
      descartado no logoff (imagem congelada), a IDE entra na imagem base e não
      é instalada por aluno.
- [ ] **2.2 Exclusões do Defender.** Sem elas o efeito é lentidão, não bloqueio:
      uma compilação com Verilator gera centenas de intermediários, e cada um
      passa pela varredura em tempo real. Por GPO, ou por PowerShell
      administrativo em cada máquina:

      Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\SAPHO"
      Add-MpPreference -ExclusionPath "$env:APPDATA\SAPHO"
      Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\sapho-updater"

      A terceira evita revarrer o instalador de ~500 MB a cada atualização.
- [ ] **2.3 Regras AppLocker/SRP**, o ponto crítico. Com a regra padrão de
      permitir execução só em `%ProgramFiles%` e `%SystemRoot%`, nada dentro de
      `%LOCALAPPDATA%` executa. São necessárias duas exceções por caminho:

      %LOCALAPPDATA%\Programs\SAPHO\*
      %LOCALAPPDATA%\Programs\SAPHO\components\*

      A segunda é indispensável e é a que costuma ser esquecida: sem ela a IDE
      abre normalmente e só falha ao compilar, com erro que parece bug da
      aplicação. O diretório `components\Temp\` também precisa permitir
      execução, por causa do executável que o Verilator compila na hora.
- [ ] **2.4 Smart App Control (Windows 11)**: verificar em Segurança do Windows
      > Controle de aplicativos e navegador. Ativo, ele bloqueia todo
      executável não assinado, inclusive os que o Verilator gera durante a
      simulação, que nunca serão assinados. Numa máquina com ele ligado a
      simulação por Verilator não roda, e assinar o instalador não resolve.
- [ ] **2.5 SmartScreen**: confirmar que a política não removeu o "Executar
      assim mesmo". Se removeu, o aviso deixa de ser aviso e vira bloqueio sem
      saída pelo lado do usuário.
- [ ] **2.6 Submeter o instalador ao [Microsoft Security Intelligence portal](https://www.microsoft.com/en-us/wdsi/filesubmission)**,
      a cada versão nova, como parte do procedimento de atualização. É tarefa
      da TI e é a ação de maior efeito contra o SmartScreen: a reputação
      orgânica exige semanas e centenas de instalações limpas, volume que
      algumas dezenas de máquinas nunca geram. Não depende da assinatura.
- [ ] **2.7 Roteiro de verificação** em cada máquina instalada. Falhando algum
      passo, o problema é quase sempre o 2.3.
      1. A IDE abre e mostra a tela inicial.
      2. Abrir um projeto de exemplo e compilar, sem erro (exercita os
         compiladores SAPHO).
      3. Executar a simulação e abrir as formas de onda (exercita
         Icarus/Verilator, GTKWave e a execução a partir de `components\Temp\`).
      4. Configurações > Sobre > Atualizações não deve dizer que não alcança o
         servidor.
- [ ] **2.8 Conferir disco e proxy**: ~1,6 GB por perfil, e o updater usa a
      configuração de proxy do sistema (Electron/Chromium).

Diagnóstico remoto, quando uma máquina parar de atualizar: peça ao aluno para
abrir Configurações > Sobre > Atualizações, que mostra situação, última e
próxima verificação, canal e último erro. O botão Abrir log revela o
`main.log`, que é o arquivo a anexar num relatório.

---

## 3. Licenciamento e assinatura de código

O instalador é não assinado, então o SmartScreen avisa na primeira execução e o
updater verifica apenas o `sha512` publicado no `latest.yml`. O projeto foi
aceito no programa gratuito da SignPath Foundation em 06/08/2026 (organização
`SAPHO [OSS]`, projeto `aurora`), mas a aprovação vale para a licença antiga,
que era MIT.

O bloqueio: os termos da SignPath exigem "an OSI-approved Open Source license
without commercial dual-licensing for all components", e a NIPS-CERN 1.1 não é
aprovada pela OSI, porque a seção 4 exige autorização prévia por escrito para
exploração comercial, contrariando o item 6 da Open Source Definition. O e-mail
perguntando isso a eles foi enviado em 10/08 e a resposta trava o resto.

Vale saber, para não gastar dinheiro à toa: certificado EV deixou de dar
reputação instantânea no SmartScreen em março de 2024, então OV e EV se
comportam igual hoje e o certificado gratuito da SignPath é a melhor opção
disponível, não um consolo. O que a assinatura compra de verdade é a reputação
acumulada no certificado do publicador, herdada pelas releases seguintes.

- [ ] **3.1 Resposta da SignPath.** Trava 3.2 e 3.5 em diante.
- [ ] **3.2 Decidir as bases de licença** com o orientador e, pela Lei de
      Inovação, provavelmente com o NIT da UFJF, antes de publicar qualquer
      mudança. A proposta: AURORA em EUPL-1.2 (ou Apache-2.0, se quiserem
      alcance máximo sem copyleft); Verilog do SAPHO em CERN-OHL-S-2.0 (ou a
      variante W, fracamente recíproca, com mais adoção e menos proteção; a P
      está descartada por ser generosa demais para a joia da casa); yanc
      continua MIT; documentação em CC-BY-4.0; NIPS-CERN 1.1 segue como base do
      laboratório para o que não entra no instalador. Verificar também
      obrigações da dupla afiliação com o CERN. A escolha da variante é
      estratégia do grupo, não conclusão técnica.
      O que viaja dentro do binário assinado, e por isso não dá para tratar as
      licenças em conversas separadas: código da AURORA, os binários yanc em
      `components/bin`, e o Verilog do SAPHO em `components/HDL`. Terceiros
      (Icarus e GTKWave GPL v2, Verilator LGPL v3, Yosys ISC, Surfer EUPL-1.2)
      entram como processo separado e ficam como estão.
- [x] ~~**3.3 Corrigir as duas afirmações falsas nos arquivos de licença.**~~
      Feito em 11/08/2026. O anexo A3 do LICENSE e as seções S1 e S3 do
      LICENSE-SAPHO.md agora dizem que a cadeia YANC está sob MIT, em
      repositório próprio, e listam os sete binários que de fato vão no
      instalador, não os quatro de antes (faltavam `cpppp`, `cppcomp` e
      `gen_gtkw`). O anexo A4 deixou de afirmar que as versões publicadas são
      assinadas, e descreve o `sha512` como a verificação existente hoje. O
      THIRD_PARTY_NOTICES trocou o "per the YANC project" pela licença real.
- [ ] **3.4 Aplicar as trocas decididas**, um commit por repositório, com a
      reescrita dos anexos A2 e A3 e do correspondente no LICENSE-SAPHO.md. No
      mesmo movimento: transformar a cessão da seção 5 da base num CLA assinado
      por quem contribui, que é o que garante a opcionalidade comercial futura;
      mover a "comunicação prévia" da seção 3 de condição de licença para
      pedido no README e no CONTRIBUTING, porque como condição ela quebra a
      aprovação da OSI e como pedido custa zero; e manter declaração explícita
      de que nome e logotipo SAPHO e AURORA não são concedidos pela licença de
      software.
- [ ] **3.5 Painel da SignPath**, que só o usuário faz: resolver a política
      `release-signing`, hoje INVALID (costuma ser Artifact Configuration
      ausente ou revisão pendente); criar a Artifact Configuration apontando
      para um único PE do Windows, `sapho-aurora-Setup-v<versão>.exe`, porque
      se ela esperar `.zip` a submissão falha; decidir o modelo de aprovação
      antes de ligar o CI, já que os termos exigem um Approver por requisição e
      o pipeline é automático (ou aprova-se cada release no painel, aceitável
      porque releases são raras, ou negocia-se dispensa para build de origem
      verificada); criar pelo menos duas contas individuais, porque o ToS §2.3
      proíbe login compartilhado e é preciso um Approver além do submissor;
      ativar 2FA para todos os contribuidores; confirmar que a organização é a
      `SAPHO [OSS]` e que não há trial ativa, que é a porta pela qual as
      cláusulas de pagamento passariam a valer; conferir o Trusted Build
      Systems, lembrando que o build roda em `aurora` e publica em `sapho`.
- [ ] **3.6 Escrever a página pública de Code signing policy** no site do
      projeto, listando os papéis (Autor, Revisor, Aprovador) e as informações
      de privacidade. É pré-requisito do primeiro release assinado.
- [x] ~~**3.7 Ligar a assinatura no `release.yml`.**~~ Feito em 11/08/2026. O
      workflow tem dois caminhos escolhidos pela existência do
      `SIGNPATH_API_TOKEN`: sem o secret, o build publica sem assinatura
      exatamente como antes, então commitar isso não mudou nada nas releases de
      hoje. Com o secret, ele constrói sem publicar, submete à SignPath, troca o
      instalador pelo assinado, refaz o manifesto e publica.

      Duas correções entraram junto, e as duas só apareceriam na primeira
      release assinada. O `patch-latest-yml.js` apagava o `.blockmap` em vez de
      refazê-lo, o que tornaria toda release assinada um download completo de
      ~500 MB para o laboratório inteiro, não só a primeira; e o portão de
      integridade do próprio workflow exige o `.blockmap` entre os assets, então
      a release teria falhado no último passo. Agora o blockmap é reconstruído a
      partir dos bytes assinados com a implementação do próprio electron-builder
      (`buildBlockMap`), o que foi verificado num ensaio: o mapa antigo descrevia
      8388608 bytes e o novo descreve os 8392704 do arquivo assinado.

      Falta só criar o secret e as três `vars` (`SIGNPATH_ORG_ID`,
      `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`) depois do item 3.5, e
      conferir os nomes dos inputs contra o README da action.

      Plano B, se a submissão pela action se mostrar chata: o hook `win.sign` do
      electron-builder pode chamar a SignPath de forma síncrona durante o build,
      e aí o `latest.yml` e o `.blockmap` já nascem dos bytes assinados, sem
      remendo depois. Custa um cliente REST próprio e não é o caminho
      documentado pela SignPath.
- [ ] **3.8 Verificar o primeiro release assinado**: `signtool verify /pa`
      passando, o updater aceitando o instalador sem erro de checksum, e o
      SmartScreen deixando de dizer "unknown publisher". Avisar a quem valida a
      instalação que o publicador exibido será "SignPath Foundation", não
      NIPSCERN nem UFJF, porque o certificado é emitido para a Foundation. Isso
      é esperado, não é sinal de adulteração. Comunicar também que essa release
      será download completo para todo mundo.

---

## 4. Verificação ao vivo

Quatro áreas têm teste unitário e nenhuma verificação de ponta a ponta. Fazer
na máquina do ensaio, com o app de verdade.

- [ ] Aurora Intelligence: uma conversa completa por provedor configurado e uma
      chamada de ferramenta que toque a IDE, como compilar ou ler arquivo,
      porque o caminho crítico é o servidor MCP local e não o modelo. A
      migração para a geração 7 do Vercel AI SDK (PR #52) nunca foi exercitada
      com provedor real, e mudança de comportamento que não apareça na tipagem
      passa pelo CI sem resistência; atenção a `createOpenAI`,
      `createAnthropic`, `createGoogleGenerativeAI`, `createDeepSeek` e
      `createGroq`, carregados por `tryRequire` em
      [main/ai/provider.js](main/ai/provider.js).
- [ ] PyLibs: instalar e remover uma biblioteca de verdade no Python empacotado.
- [ ] Painel Git (Dagr): clone, commit, push e uma resolução de conflito.
- [ ] GTKWave e Surfer: está provado que os executáveis sobem e que os arquivos
      de configuração (`.gtkw`, `.surf.ron`) são gerados certos, mas não que o
      desenho na tela está certo, e isso é limite do método. O Surfer subiu
      cinco tags em 10/08 e ganhou um painel lateral retrátil com atalho de
      teclado; vale abrir uma forma de onda e olhar.
- [ ] Anel de foco no Monaco: a sonda anterior varreu o foco sem arquivo aberto
      no editor, então não há medida de lá. Abrir um `.v` de verdade pelo
      harness e varrer com o Monaco montado. O corpo do terminal e a lista de
      mensagens do chat já foram medidos e corrigidos.

---

## 5. Melhorias na AURORA

Pós-release, com a regra de sempre: medir antes de mexer.

- [ ] **P6, o que sobrou de performance.** Restam as transições de largura da
      árvore (`.file-tree-container`) e do painel de IA
      (`.ai-assistant-container`), e só na abertura e no fechamento pelo botão;
      o arranque, que animava a largura salva a partir de zero e gastava 220 ou
      240 ms de relayout de Monaco em toda abertura, já foi corrigido em 10/08.
      O custo do que sobrou não é mensurável pelo harness: numa janela que o
      compositor considera não visível, como a que o Playwright sobe, o
      Chromium pausa a animação e o `requestAnimationFrame` não dispara, então
      a sonda devolve zero amostras. Medir exige o aplicativo aberto de
      verdade, com projeto carregado e arquivos no editor. Sem essa medida,
      trocar por `transform` é mudança estrutural apostada num ganho que
      ninguém viu: exige invólucro de largura fixa em volta dos dois painéis e
      muda o comportamento, porque hoje o editor cresce junto com o colapso e
      com `translateX` ele passaria a saltar no fim. O `.ai-usage-fill` fica
      como está, por decisão registrada: animar largura ali não relayouta
      editor nenhum e `scaleX` distorceria as pontas arredondadas da barra.
- [ ] **God files.** `js/ui/ai_assistant_manager.js` (3533 linhas) e
      `js/compilation/compilation_module.js` (3125) são cada um uma classe só,
      com zero funções em nível de módulo, então não há núcleo puro para
      extrair sem mover estado e mudar pontos de chamada. O caminho decidido é
      o inverso do que parece: primeiro cobrir por fora, com E2E que exercite o
      painel de IA e o fluxo de compilação pela interface, e só então mover
      código por dentro com a rede no lugar. O `main/ai/tools.js` fica de fora:
      é vetor de dados e não lógica, dividi-lo por namespace mudaria a ordem em
      que as ferramentas chegam ao modelo, e não destrava teste nenhum, já que
      o manifesto é verificado pelo `tool_manifest.test.js` e pelo gerador da
      documentação. O método que funcionou três vezes e vale repetir: achar o
      núcleo que não depende de nada, tirar para um módulo próprio, escrever
      teste em cima.
- [ ] **CRUD da árvore de arquivos**, lacunas remanescentes: multi-select com
      Ctrl e Shift, undo com Ctrl+Z, auto-refresh por watcher na visão Folders,
      preservar cursor e scroll no rename, awareness do `.spf`. O drag and drop
      já saiu em 08/08.
- [ ] **Restos de design.** Noventa e seis valores em propriedade de espaçamento
      fora da escala, como 10, 14 e 18 px: ou a escala ganha esses degraus, ou
      eles ficam. Setenta e quatro `!important`, dos quais cerca de trinta
      vivem no `editor.css` contra o CSS do próprio Monaco e só saem com o
      editor em Shadow DOM. Consolidar as paletas divergentes de `splash.html`
      e `update-notification.html` na fonte única de tokens. Avaliar um lint de
      design no CI, que falhe em hex cravado, `!important` novo e duração fora
      de token. Decidir a marca entre SAPHO, AURORA e Dagr.
- [ ] **jQuery preso na 3.x pelo digitaljs.** O digitaljs 0.14.2, que desenha a
      simulação interativa do PRISM, declara `jquery: ^3.7.1`. Subir a raiz
      para a 4 instala duas cópias e o digitaljs resolveria a sua própria, sem
      o jquery-ui anexado, trazendo de volta o `e.widget is not a function` do
      commit `52696d9c`. O jquery-ui aceita até a 5, então não é ele o
      obstáculo. Destravar quando o digitaljs publicar suporte, subindo os dois
      juntos e abrindo o modo Simular num design real.

---

## 6. Profissionalizar o repositório

- [ ] **Mídia real do README**, hoje inexistente. Capturar do app de verdade,
      sem fabricar arte, e guardar em `docs/media/`: `hero.png` com a IDE de
      projeto aberto, editor, árvore e terminal, ~1600 px de largura;
      `split-editor.gif` mostrando o split e o modelo compartilhado entre
      panes; `compile.gif` com uma corrida C± → ASM → Verilog → simulação e o
      terminal transmitindo; `prism.gif` com zoom e pan no visualizador RTL;
      `waveform.gif` com uma forma de onda no Surfer ou GTKWave. GIFs de poucos
      MB, otimizados com `gifsicle -O3` ou exportados como MP4 mudo. Quando
      existirem, trocar a frase do README que diz que estão pendentes.
- [x] ~~**CITATION.cff** com `date-released` defasado.~~ Resolvido na raiz em
      11/08/2026: o arquivo entrou no `extra-files` do release-please e as duas
      linhas ganharam as anotações `x-release-please-version` e
      `x-release-please-date`, então versão e data passam a ser reescritas a
      cada release em vez de depender de alguém lembrar.
- [x] ~~**release-please-config.json** com `package-name` divergente.~~
      Decidido em 11/08/2026 manter `aurora-ide`. O nome não é o do pacote npm
      de propósito: identifica o componente no release-please, e é ele que
      compõe o nome da branch (`release-please--branches--main--components--aurora-ide`).
      Mudar agora abandonaria o PR #63 e abriria outro do zero, na véspera da
      release. Se um dia for mudar, mude logo depois de uma release sair, nunca
      com PR de release aberto.
- [ ] **`docs/referencia-tecnica-sapho/_fonte/apendices/referencias.tex`** cita
      `ROADMAP.md` e `RELEASE.md`, que não existem, e agora também os
      documentos removidos nesta consolidação. Limpar na próxima edição do
      relatório.
- [x] ~~**Verificar o `LICENSE-BASE.md` fora do instalador.**~~ Decidido em
      11/08/2026 que fica fora, e a razão está registrada no bloco
      `//build-licences` do package.json: o texto da base já são as primeiras
      239 linhas do `LICENSE`, que vai no instalador, e embarcar as duas cópias
      é como elas divergem e passam a se contradizer.

---

## 7. C++ como segunda linguagem de processador

Ao lado do C±. O front end do yanc já existe (`cpppp` mais `cppcomp`) e
converge no mesmo assembly, então o trabalho é integração do lado da AURORA
mais um painel próprio. Vale a regra do ARCHITECTURE §13: toda capacidade sai
como API chamável pela IA antes de sair como botão.

Nada disto foi implementado: `js/compilation/builders/` não tem `cpp` e o
`binary_allowlist.js` não menciona `cpppp` nem `cppcomp`.

**Decidir antes de começar**: renomear o campo `cmmFile` do `.spf` para
`sourceFile`, com migração automática na abertura do projeto. Manter o nome
antigo apontando para um `.cpp` é dissonante, e o custo do rename cresce com a
base de projetos.

- [ ] **Fase 1, pipeline funcionando, só AURORA.** `cpppp.exe` e `cppcomp.exe`
      na allowlist sob `bin`; `js/compilation/builders/cpp.ts` com
      `buildCppPpSpec` e `buildCppSpec` no molde do `cmm.ts`, reexportado no
      `builders/index.ts`; ramo `'cpp-pp' | 'cpp'` no `spec_factory.ts`,
      trocando o `replace(/\.cmm$/i, '')` das linhas 141 e 162 por remoção de
      extensão genérica; campo `language` no `.spf` por processador, derivado
      da extensão quando ausente; `cppCompilation` no `processor_compiler.js`,
      irmão do `cmmCompilation`; despacho por linguagem no `compilation_flow.js`
      (`handleCmmStep`, `resolveFallbackCmmPath`, `precompileAllProcessors`,
      `STEP_TERMINALS`, `STEP_CLEARS`); `.cpp` em `SOFTWARE_EXTENSIONS`
      (`js/project/file_mode.js`), no `document_type_detector.js` e nos filtros
      de diálogo; `compile.compileStep('cpp')` e despacho em `compileAll()` na
      `aurora_api.js`; `'cpp'` nos enums de `compile_step` e `run_in_background`
      em `tools.js`, com `listSteps`, `inspectCommand`, `previewCommand` e
      overrides reconhecendo os passos novos; aviso no terminal quando o fonte
      tiver `#include`, porque os números de linha passam a ser do arquivo
      expandido. Testes de unidade sobre o builder novo, sobre a derivação de
      linguagem e sobre o despacho, mais um E2E compilando o `proc_cpp` do yanc
      dentro de um projeto AURORA.
- [ ] **Fase 2, painel e API completa.** Extrair a validação e os nove campos de
      hardware do `processor_hub.js` para módulo comum e construir por cima
      dele o painel de criação de processador C++, com template e headers;
      template `.cpp` com pragmas no handler `create-processor-project` de
      `main/ipc/project.js`; parser irmão do `parseCmmHeader` para
      `#pragma yanc`; renomeador corrigindo `#pragma yanc prname` no `.cpp`;
      `language` em `createProcessor`, `getProcessorConfig` e `listProcessors`;
      `setProcessorSource` novo na API e `set_processor_source` em tools.js;
      seção `pragmas` no `resources/sapho_rules.json` com
      `rules.listPragmas`/`getPragma` e as tools correspondentes;
      `rules.getCppStdlib` e a tool `get_cpp_stdlib`; parágrafo C++ no
      `system_prompt.js` com os limites declarados; ícone de `.cpp` na árvore;
      `showArrays` escondido para processadores C++.
- [ ] **Fase 3, paridade de linguagem, no repositório yanc.**
      `#pragma yanc toaqui` e `praca` no `cppcomp`, com o `ensureChegueiToaqui`
      da AURORA emitindo a forma pragma; builtins `fin()` e `fout()`; `<cmath>`
      como casca sobre as macros `float_*.asm`, substituindo o `sqrt` por
      software; `#line` emitido pelo `cpppp` e respeitado pelo `cppcomp`; casos
      novos no `regress.sh` cobrindo cada item.

Limites aceitos enquanto as fases não fecham: as mensagens do `cppcomp` só
existem em inglês, o que é dívida do yanc e deve ser sinalizado no terminal; um
processador C++ não roda no botão Verilator por falta de `#TOAQUI`, então o
botão fica desabilitado com explicação em vez de falhar calado; e a ausência de
transcendentais é o limite real de aplicabilidade, o que deixa controle,
protocolo, máquina de estados e aritmética inteira ou de ponto fixo viáveis em
C++, e DSP com seno, exponencial ou complexos como território exclusivo do C±.

---

## 8. Depois do laboratório

Escopo do SAPHO seguinte. Prioridade muda conforme a necessidade da disciplina.

- [ ] Processo de IA persistente por conversa, para matar o arranque frio da
      CLI a cada turno, e aposentar os caminhos antigos de spawn quando os
      motores de SDK tiverem rodagem.
- [ ] Surfer embutido, saindo de opção para padrão. Hoje é janela externa como
      o GTKWave; embutir depende de um bundle WASM que o projeto de origem não
      publica em formato baixável, e isso está bloqueado por eles.
- [ ] Terminar a migração da casca para Lit, levando abas, árvore, terminal e
      barra de estado para declarativo, com o editor como hospedeiro.
- [ ] Multiplataforma, avaliando Linux e macOS, hoje impedido porque a
      toolchain empacotada é só de Windows.
- [ ] Interface definitiva. Ficou de fora da versão do laboratório de propósito:
      redesenhar às vésperas de congelar a versão que vai para trinta máquinas
      troca risco conhecido por risco desconhecido, sem ganho para a aula.

---

## Princípios de desenho

Resumo do manifesto de interface, mantido aqui porque comentários no CSS e no
JS o citam por seção. É proposta com histórico, não descrição do que está na
tela: onde foi tentado e revertido, a reversão vale mais que o texto.

A AURORA é luz contra o escuro, e toda decisão deriva de como uma aurora boreal
se comporta no céu noturno. Quatro propriedades do fenômeno viram quatro regras.
Emissão: a cor de marca é uma transição vertical verde, teal, violeta, nunca um
acento chapado, e as 16 cores estáveis de processador derivam matiz desse mesmo
espectro, para um projeto multiprocessador parecer uma aurora de várias bandas
e não um arco-íris. Deriva: movimento é fluxo contínuo e eased, sem spring,
bounce ou overshoot, porque aurora não salta. Luminosidade: elevação se
expressa por glow e borda luminosa, não por drop-shadow, então um painel sobe
ficando mais claro que o céu e ganhando borda, com glow reservado ao acento e
ao estado. Raios: seleção e foco são marcados por um raio luminoso vertical
fino de 2 px à esquerda do item, não por preenchimento sólido.

Sobre movimento, as regras invioláveis: anima só `transform` e `opacity`, nunca
largura, altura ou margem, que é o que garante o orçamento de 6 ms por quadro;
conteúdo revela, não voa, ou seja, entrada é opacidade com no máximo 4 px de
deslocamento vertical, como cortina que clareia e não card chegando de fora;
rápido onde o usuário espera e lento onde ele não espera; `will-change`
cirúrgico, aplicado no início da interação e removido no fim; e
`prefers-reduced-motion` cortando tudo que é ambiente.

A regra que protege o conjunto: decoração só existe quando é a identidade, a
aurora, e quando não atrapalha. Todo o resto do movimento precisa ter trabalho,
seja orientar, mostrar causa e efeito, ou manter contexto numa troca de estado.
Movimento sem função é removido.

Dark-only é identidade, não limitação, porque a aurora não existe ao meio-dia;
o `.theme-light` continua morto em `css/base/styles.css` e é para ser aposentado
formalmente, não consertado.

---

## Notas que evitam retrabalho

- O binário do Verible da tag `v0.0-4135-g7807ee1a` se declara
  `v0.0-4131-g93141f42` no `--version`. Não é instalação velha, e o exe
  instalado bate byte a byte com o do zip da release: é o carimbo do próprio
  Verible andando atrás da tag. Não reinvestigar.
- Testes de geometria E2E: a janela pede 1280 px e o Windows corta para o que
  couber no monitor. Medir a janela antes de suspeitar do código.
- Máquina nova de desenvolvimento: `git pull`, `npm ci`,
  `node scripts/verify-components.js --yes`. Conferência sem baixar nada:
  `node scripts/check-component-drift.js`, que deve dizer "7 em dia". A pasta
  `components/` não é versionada, então um `git pull` traz os scripts mas não os
  binários.
- O barramento de eventos da AuroraAPI não tem nenhum assinante, e o comentário
  que diz que a Aurora Intelligence o consome está impreciso: não existe
  ferramenta no manifesto que permita ao modelo assinar evento. A ponte
  funciona e custa sete listeners no arranque, então não há urgência; o que
  está errado é a afirmação.
- A família do Vercel AI SDK (`ai` mais `@ai-sdk/*`) nunca sobe em pedaços,
  porque o núcleo fixa a versão da interface `@ai-sdk/provider` e cada provedor
  é compilado contra uma delas. O grupo `ai-sdk` do dependabot já garante isso,
  e foi o que produziu o PR #52 depois de os PRs #50, #41 e #43 tentarem
  separadamente.
- Uma varredura estática em 08/08 descartou quatro classes inteiras de bug, e
  não vale refazer: a superfície de IPC está casada, com 184 canais chamados e
  184 registrados; não sobrou `exec` de string montando comando, então caminho
  com espaço não quebra invocação; os marcadores de pendência no código são
  três e nenhum descreve defeito; e a toolchain foi provada com caminho
  acentuado. O que a varredura não alcança é o que precisa de uso real:
  comportamento errado que compila, mensagem de erro que não ajuda, e qualquer
  coisa que dependa de sequência de cliques.
- A lista de bugs vem do uso, não de auditoria. Conforme aparecerem, entram
  aqui com o caminho para reproduzir.
