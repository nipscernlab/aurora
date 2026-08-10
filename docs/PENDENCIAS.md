# O que falta

Backlog honesto do que ainda não foi feito para a AURORA e o SAPHO entrarem no
laboratório de Dispositivos Lógicos Programáveis. Escrito em 06/08/2026 e
consolidado em 07/08/2026, quando passou a ser o único backlog do projeto:
o `ROADMAP.md` e as duas listas que viviam dentro do estudo guarda-chuva foram
fundidos aqui.

A regra é uma só: entra aqui o que não foi feito. Ao concluir um item, apague o
registro; o git guarda a história melhor do que uma lista de coisas feitas.

Aquelas listas antigas mostraram por que a regra importa. Numa amostra de nove
itens que elas marcavam como abertos, oito já estavam prontos, entre eles o
`deadcode` no CI, o token de sessão do MCP local e a allowlist das ferramentas
das CLIs de IA. Um backlog em que não se pode confiar é pior do que backlog
nenhum, porque ele custa releitura e produz decisão errada.

---

## Estado verificado em 06/08/2026

| | |
|---|---|
| CI na `main` | verde (commit `c6dfaef`, inclui build de smoke do electron-builder) |
| Dry run do release | passou — "Publish access to nipscernlab/sapho confirmed" |
| Testes | 24 toolchain, 645 unitários, 13 E2E |
| `npm audit` | 0 vulnerabilidades |
| Identidade | `SAPHO.exe`, `%LOCALAPPDATA%\Programs\SAPHO`, `appId` alinhado com o main.js |

Os bloqueios do pipeline de release estão todos resolvidos e verificados. O que
segue abaixo é o que ainda não foi tocado.

---

## 1. Ensaio real de atualização — a lacuna mais séria

**Por que importa mais que o resto.** O updater foi endurecido, a lógica de
agendamento tem 12 testes, e o mecanismo de delta foi verificado no código do
electron-updater e na máquina. Mas **ninguém nunca viu uma atualização
acontecer** com esse código. Nem eu, nem você.

A promessa para o laboratório é "instala uma vez e atualiza remotamente, sem
voltar presencialmente". Essa promessa nunca foi exercitada. Se ela falhar, vai
falhar em 30 máquinas ao mesmo tempo, com aula acontecendo.

**Decidido em 07/08/2026:** não sai release enquanto isso. Versionar e preparar
tudo, sim; publicar, não. A release que for publicada será a definitiva, a mesma
que vai ser instalada no laboratório. O PR #63 (`chore(main): release 6.4.0`)
fica aberto até lá, e o ensaio abaixo acontece com ela, não com uma versão
intermediária.

**O ensaio, em ordem:**

1. Merge do PR de release, quando a versão definitiva estiver fechada. Isso
   publica a release no `aurora`, que dispara o `release.yml`, que constrói e
   publica o instalador em `nipscernlab/sapho`.
2. Instalar essa 6.4.0 numa máquina limpa.
3. Fazer uma alteração trivial e publicar uma 6.4.1.
4. Abrir o app na máquina limpa e observar o ciclo inteiro.

**O que observar, item por item:**

- A checagem silenciosa dispara ~6 s após o boot, e a janela de atualização
  aparece com o changelog preenchido (as release notes são espelhadas do
  `aurora` para o `sapho` pelo `release.yml`; corpo vazio significa que esse
  passo falhou).
- O download é **incremental**. Dá para medir: acompanhe os MB transferidos na
  própria janela e compare com os ~500 MB do instalador completo. Se transferir
  tudo, o delta não engatou, e a causa provável está em §19.3.
- Fechar o app aplica a atualização em silêncio, sem elevação, e a próxima
  abertura mostra a versão nova com o toast de confirmação.
- *Configurações → Sobre → Atualizações* reflete o que aconteceu.

**Teste de resiliência, no mesmo ensaio:** derrube a rede no meio do download e
confirme que a janela mostra a contagem regressiva de nova tentativa e retoma
sozinha, em vez de congelar a barra de progresso.

---

## 2. Interface: feito em 08/08/2026, e o que sobrou

Os cinco pontos que restavam do [DESIGN.md](DESIGN.md) e do estudo de interface
foram executados. Nada aqui mudou marcação: é tudo CSS, e tudo reversível commit
a commit.

**Raio de foco na árvore.** A árvore de hierarquia já marcava o item ativo com um
raio de 2 px à esquerda, em acento chapado; a de arquivos não tinha nada. As duas
passaram a usar a mesma forma com o gradiente da marca. O tingimento de fundo
ficou, contra a letra do manifesto: o `--surface-raised` que ele manda usar
resolve para `--bg-elev`, o próprio fundo do painel, e seguir a letra deixaria a
seleção dependendo de dois pixels.

**Foco de input com o gradiente.** Feito pelo truque de dois fundos, porque
gradiente não pode ser `border-color` e `border-image` quadraria os cantos
arredondados dos campos.

**Sombra para luz.** Sobrou zero `box-shadow` escuro no CSS. O substituto já
existia definido e nunca usado, `--elev-overlay` e `--elev-raised`, que agora têm
17 usos. Ficaram de propósito os nove `inset`, que fazem papel de divisor, e os
onze brilhos de acento, que a seção 4 manda manter.

**Botões.** A base compartilhada foi para `css/base/controls.css`, com os cinco
seletores existentes. Os nomes de classe não mudaram: são 37 usos espalhados por
`index.html` e pelo JS, sem teste visual embaixo. A duplicação que custava caro,
três lugares para editar quando o botão muda, acabou.

**Valores mágicos.** Aqui o estudo inflava o número por dez. Dos 573 literais de
pixel contados, apenas 46 eram de fato espaçamento com valor existente na escala,
e esses foram trocados. O resto é borda de 1 px, tamanho de ícone, altura de
controle e posicionamento absoluto, onde usar `--space-*` mentiria sobre a
intenção.

**O que sobrou, e é pouco.** Noventa e seis valores estão em propriedade de
espaçamento mas fora da escala, como 10 px, 14 px e 18 px; ou a escala ganha esses
degraus, ou eles ficam. Os 73 `!important` continuam, e trinta deles vivem no
`editor.css` contra o CSS do próprio Monaco, o que só sai com o editor em Shadow
DOM. E a decisão de marca entre SAPHO, AURORA e Dagr continua aberta.

---

## 2.1 Os oito pedidos de 08/08/2026

Todos executados, e um deles rendeu mais do que parecia.

Os resizers da árvore, do painel de IA e do terminal passaram a se comportar como
os do VS Code: encolhem até um mínimo e colapsam se você forçar além do limiar.
Antes o arrasto travava no mínimo e colapsar só era possível pelo botão. O painel
de IA sobrepunha o terminal e os splits porque o teto dele era
`window.innerWidth * 0.7`, sem descontar a árvore nem reservar espaço para o
editor; como o container do editor tem `min-width: 0`, ele era espremido até
zero. A regra virou aritmética pura em `js/utils/pane_size.js`, com teste.

O log de atualização estava gigantesco por dois motivos, e os dois viraram um
`debug`: o `.inv` inexistente era lido sem checar antes, e a jumplist logava a
cada ronda mesmo sem nada mudar, o que sozinho dava 924 entradas, 63% do
`main.log`.

A varinha de formatar ficou à esquerda do botão de split e dispara a ação padrão
do Monaco, então não escolhe formatador: cada idioma registra o seu. C, C++ e C±
já tinham o clang-format empacotado e o Verilog já tinha o Verible; faltava o
Python, que agora vai pelo black. A mesma formatação virou ferramenta da Aurora
Intelligence (`format_file`), porque sem ela a IA reescreve o arquivo inteiro só
para arrumar indentação.

O manual offline passou a perguntar onde abrir. No navegador vêm abas, busca e
favoritos de graça; na AURORA abre uma janela nossa, frameless e com a barra
desenhada por nós, para quem não tem navegador ou está numa máquina com a
associação de `.html` removida.

A visão Folder ganhou arrastar e soltar, com Ctrl para copiar, e o ícone do input
de criação passou a seguir o que está sendo digitado, então dá para ver que
`main.py` vira um Python antes de o arquivo existir.

Sobre o bump de versão: não há o que mudar. O `release-please` acumula os commits
convencionais e propõe a versão numa PR; só o merge dela cria a tag e dispara o
build do instalador. Enquanto essa PR não for aceita, nenhum release sai. Era
exatamente o pedido.

---

## 2.2 Abas do terminal: resolvido virando coluna

A lista de excedente, que escondia as abas que não coubessem atrás de um botão,
passava no e2e e nunca disparou em uso real. Ela foi removida em 08/08/2026, e
não por não funcionar: foi porque a solução certa era outra.

Abaixo de 780 px de largura do terminal as abas saem da faixa horizontal e viram
uma coluna à direita, empilhadas. Empilhar resolve o mesmo aperto sem esconder
nada de ninguém, e o limiar entra enquanto ainda há folga, não no limite. O
gatilho tem teste e2e nos dois sentidos, medindo o retângulo das abas.

Com a coluna entrando tão cedo, a faixa em que a lista ainda teria função ficou
estreita demais para justificar código que não se sabia por que não rodava.
Saíram 350 linhas entre módulo, plano e testes.

---

## 3. Otimização de runtime

Pedido como "devemos otimizar muito o software". O que foi feito é otimização
de **empacotamento**: 241 MB de binário morto fora do instalador, e a
investigação do delta que descartou dois caminhos falsos (§19.3). Desempenho de
execução não foi tocado.

A agenda existe mapeada na §4 do ESTUDO, com os itens principais sendo um editor
Monaco completo por arquivo aberto, terminal e árvore sem virtualização, e
`transition: width` que força relayout. Nada disso foi medido nem atacado nesta
sessão.

Recomendação: medir antes de mexer. O diagnóstico de performance é de junho e
vários itens já foram resolvidos desde então.

Ao atacar isso em 08/08/2026 apareceu um bug de verdade, maior que o item
original, e ele foi corrigido.

Dois comentários afirmavam que a animação de largura era suspensa durante o
arrasto de um divisor: o do topo do `js/utils/resize.js` e o do
`.file-tree-container` em `css/base/layout.css`, que apontava para o
`styles.css`. A regra nunca existiu; o CSS que o `resize.js` injeta só definia
cursor e seleção de texto. O resultado é que cada movimento do mouse reiniciava
uma transição de 220 ms, e de 240 ms no painel de IA, então o painel arrastava
atrás do cursor e cada quadro forçava relayout de todos os editores Monaco
abertos. As classes já eram postas no `body` pelos dois arrastadores; faltava
apenas consumi-las, e é o que a regra nova em `styles.css` faz.

Também estava errada a minha própria anotação de que eram três ocorrências. A
terceira, em `ai_assistant.css:1668`, é a barra de progresso do medidor de uso:
animar largura ali não relayouta editor nenhum, e trocar por `scaleX`
distorceria a barra. Ela fica como está.

Continua aberto, e agora com escopo honesto: as duas transições de painel ainda
animam largura ao abrir e fechar pelo botão, fora do arrasto. Trocar por
`transform: translateX` exige um invólucro de largura fixa em volta de cada
painel, que é mudança estrutural nos dois painéis principais. Não cabe antes de
congelar a versão; fica para depois, e o custo hoje é uma alternância ocasional,
não um arrasto contínuo.

---

## 3.1 Caçada de bugs por varredura estática, 08/08/2026

Antes de esperar a lista de bugs vinda do uso, vale registrar o que uma varredura
sistemática procurou e o que ela achou, para ninguém refazer o mesmo caminho.

Quatro verificações passaram limpas, e cada uma é uma classe inteira de bug
descartada. A superfície de IPC está perfeitamente casada: 184 canais chamados
pelo renderer, 184 registrados no processo principal, zero de cada lado sem par;
um descompasso ali deixaria um `invoke` pendurado na mão do usuário sem erro de
build. Não sobrou `exec` de string para montar comando, então caminho com espaço
não quebra invocação. Os marcadores de pendência no código são três, e nenhum
descreve defeito. E a toolchain foi provada com caminho acentuado, que era a
lacuna mais provável de morder no laboratório.

Uma coisa ficou registrada como imprecisão, não como bug. O barramento de eventos
da AuroraAPI não tem nenhum assinante: cada nome de evento aparece uma única vez,
na própria tabela da ponte. O comentário no código diz que a Aurora Intelligence
consome essa superfície, e ela não consegue, porque não existe ferramenta no
manifesto que permita ao modelo assinar evento. A ponte funciona e custa sete
`addEventListener` no arranque, então não há urgência; o que está errado é a
afirmação.

O que a varredura estática não alcança continua sendo o que precisa de uso real:
comportamento errado que compila, mensagem de erro que não ajuda, e qualquer
coisa que dependa de sequência de cliques.

---

## 4. Áreas com cobertura mais fina do que parece

Todas têm testes unitários. Nenhuma foi exercitada ao vivo, de ponta a ponta.

**Aurora Intelligence.** 110 testes unitários, zero verificação com provedor
real. Testar consome cota de API do usuário, então não foi feito por iniciativa
própria. Vale ao menos uma conversa completa por provedor configurado, e uma
chamada de ferramenta que toque a IDE (compilar, ler arquivo), porque o caminho
crítico é o servidor MCP local e não o modelo.

**PyLibs.** 42 testes unitários. Instalar e remover uma biblioteca de verdade no
Python empacotado nunca foi testado em integração — só a lógica em volta.

**Painel Git (Dagr).** 25 testes unitários, nenhum E2E. Clone, commit, push e
resolução de conflito nunca rodaram automatizados.

**GTKWave e Surfer.** Está provado que os executáveis sobem e que os arquivos de
configuração (`.gtkw`, `.surf.ron`) são gerados corretamente. **Não** está
provado que o desenho na tela está certo. Isso é limite do método e continua
sendo teste manual.

---

## 5. Assinatura de código

Estado e obrigações completos em [CODE_SIGNING.md](CODE_SIGNING.md); o resumo do
programa está na §19.7.

**Antes de qualquer item desta seção, resolver a elegibilidade.** A troca de
licença de 08/08/2026 derrubou a premissa do programa gratuito da SignPath, que
exige licença aprovada pela OSI e a NIPS-CERN 1.1 não é, por ser não comercial. A
aprovação que existe no painel deles é de 06/08 e vale para a licença antiga. As
três saídas possíveis estão no bloco de bloqueio no topo do
[CODE_SIGNING.md](CODE_SIGNING.md), e a mais barata, escrever para eles e
perguntar, vem primeiro. Enquanto isso não estiver decidido, os itens abaixo são
trabalho que pode não ter serventia.

**Pendente de ação no painel da SignPath (só o usuário faz):**

- Resolver a política `release-signing`, que está marcada **INVALID**. Abrir a
  política e ler o motivo; costuma ser Artifact Configuration ausente ou revisão
  pendente da Foundation.
- Criar a **Artifact Configuration** apontando para um único PE do Windows,
  `sapho-aurora-Setup-v<versão>.exe`. Se ela esperar `.zip`, a submissão falha.
- Decidir o **modelo de aprovação**. Os termos exigem que cada requisição de
  assinatura seja autorizada por um Approver, e o pipeline é automático. Ou
  aprova-se cada release no painel (releases são raras, é aceitável), ou
  configura-se dispensa para build de origem verificada. **Precisa estar
  decidido antes de ligar a assinatura no CI.**
- Criar **contas individuais** para quem for participar do fluxo. O ToS §2.3
  proíbe compartilhar login, e como é preciso um Approver por requisição, são
  necessárias **pelo menos duas contas**. Login coletivo de laboratório não é
  opção. Ver a leitura do ToS no [CODE_SIGNING.md](CODE_SIGNING.md).
- Confirmar no painel que a organização é a `SAPHO [OSS]` e que **não há
  assinatura de avaliação ativa**. A trial é do produto comercial, e é por ela
  que as cláusulas de pagamento do ToS passariam a valer.
- Conferir o **Trusted Build Systems**. O build roda em `nipscernlab/aurora` e
  publica em `nipscernlab/sapho`; a verificação de origem olha onde o binário
  foi construído, então `aurora` deve bastar, mas vale confirmar na tela deles.
- Ativar **2FA para todos os contribuidores** da organização.

**Pendente de escrita (o usuário assumiu):** a página pública de *Code signing
policy* no site do projeto, listando os papéis (Autor, Revisor, Aprovador) e as
informações de privacidade. É pré-requisito do primeiro release assinado.

**Pendente de implementação (assim que os três slugs existirem):** ligar a
assinatura no `release.yml`. O YAML pronto está no CODE_SIGNING.md, e o
`scripts/patch-latest-yml.js` já existe para re-hashear o `latest.yml` — sem
esse passo, a assinatura muda os bytes e toda atualização falha por checksum.

**Restrição de projeto, decidida a partir da leitura do ToS:** a assinatura
entra **condicionada** à existência do token, degradando para build não assinado
em vez de bloquear o release. Dois motivos: o serviço não tem garantia de
disponibilidade (§9/§10), e o certificado pode ser revogado inclusive de forma
retroativa. Assinatura não pode virar bloqueio duro para uma correção urgente, e
o caminho não assinado do [IMPLANTACAO_LABORATORIO.md](IMPLANTACAO_LABORATORIO.md)
precisa continuar válido mesmo depois de a assinatura funcionar.

**Efeito colateral a comunicar:** o primeiro release assinado será download
completo para todo mundo, porque a assinatura invalida todos os blocos do delta.
Depois dele, volta ao incremental.

---

## 6. Itens externos, pequenos

- **jQuery preso na 3.x pelo digitaljs.** O digitaljs 0.14.2, que desenha a
  simulação interativa do PRISM, declara `jquery: ^3.7.1`. Subir a raiz para a 4
  instala duas cópias e o digitaljs resolveria a sua própria, sem o jquery-ui
  anexado, trazendo de volta o `e.widget is not a function` do commit `52696d9c`.
  O jquery-ui aceita até a 5, então ele não é o obstáculo. O `dependabot.yml`
  ignora só a major; destravar quando o digitaljs publicar suporte, subindo os
  dois juntos e abrindo o modo Simular num design real.
- **Fonte Norse: resolvido em 08/08/2026.** A fonte entrava no instalador. O
  Vite a copiava para `dist/assets/` e o `electron-builder` não exclui
  `assets/`, então o `.exe` que ia para as máquinas do laboratório carregava o
  arquivo dentro. Ela era gitignorada, o que respeitava a licença quanto ao
  repositório, mas publicar um instalador com ela dentro é distribuição, e era
  exatamente o que a licença proibia.

  O letreiro passou a usar Metamorphous nas letras latinas e Noto Sans Runic na
  runa Dagaz, as duas sob SIL OFL 1.1, que permite redistribuir e embutir. Elas
  vêm pelo `scripts/fetch-fonts.js` e são commitadas como a Inter e a JetBrains
  Mono, então sumiram o `download-norse-font.js`, o passo do CI e as duas linhas
  do `.gitignore`. São 47 KB para as três faces.
- **Mídia real do README**: os GIFs continuam sendo scaffold.
- **Submissão do instalador ao Microsoft Security Intelligence portal**, pela
  TI do laboratório, quando houver instalador definitivo. É a ação de maior
  efeito contra o SmartScreen e não depende da assinatura estar pronta
  ([IMPLANTACAO_LABORATORIO.md](IMPLANTACAO_LABORATORIO.md) §4.4).

---

## 7. Split dos god files

Quatro arquivos concentravam o problema quando isto foi escrito: `main/ai/tools.js`
com 1532, `main/ipc/project.js` com 982, `main/ipc/prism.js` com 964 e, no
renderer, os dois maiores de todos. Nenhum tinha divisão interna por assunto, e
cada funcionalidade nova entrava empilhando no mesmo lugar.

**A planta baixa já existe.** A branch local `backup/a2-godfiles` propôs a
divisão em agosto e foi arquivada na tag `archive/a2-godfiles` (ponta
`de38e4a6`), recuperável com `git checkout archive/a2-godfiles`. O desenho dela:
`tools.js` vira nove módulos por namespace (compile, editor, misc, project,
rules, settings, terminal, wave, mais um index que remonta o manifesto);
`prism.js` vira cinco (index, module_names, pipeline, svg, window); `project.js`
vira cinco (helpers, index, lifecycle, processors, rename). A soma das linhas dos
módulos bate com a do arquivo original em cada caso, com diferença só do
boilerplate de import e export, o que confirma que era movimentação pura, sem
mudança de comportamento.

**Por que a branch não foi mergeada.** Ela partiu de `9bd05e80`, e desde essa
base 21 commits da main tocaram exatamente esses três arquivos, somando 682
linhas: a memória de projeto da IA, as tools de git, a simulação DigitalJS no
PRISM, o fork do Surfer. Reaplicar o split daquela época conflitaria com tudo
isso e correria risco de reverter funcionalidade. Das cinco suítes de teste que
ela trazia, quatro já estão na main; a quinta exercita um método `initialize()`
que a main não tem, porque a main chegou ao mesmo construtor puro por outro
desenho de API.

**O que foi feito em 08/08/2026, e o método que funcionou.** A divisão só vale a
pena quando serve para alguma coisa, e o que ela serve é tornar o código
alcançável por teste. O procedimento que deu certo, três vezes, é sempre o
mesmo: achar o núcleo que não depende de nada, tirar para um módulo próprio,
escrever teste em cima.

Saíram assim, com CI verde em cada passo, `main/ipc/project_paths.js` com a
leitura tolerante do `.spf` e a reescrita de caminhos no rename, com 22 testes;
`main/ipc/surfer_config.js` com a geometria da janela e a higienização do nome de
mapping, com 16; e `js/api/api_core.js` com o envelope de resposta e o barramento
de eventos, com 18. O `project.js` caiu de 982 para 887 linhas.

A extração do `api_core` revelou por que o `aurora_api.js`, com 2957 linhas,
nunca teve um teste sequer: importar aquele arquivo inicializa a IDE inteira,
porque a cadeia de imports chega ao `tab_manager`, que se auto-inicializa em
tempo de carga e chama IPC que não existe fora do Electron. É a fragilidade dos
construtores que fazem entrada e saída, descrita na seção 8 do
[ARCHITECTURE.md](../ARCHITECTURE.md), agora com consequência medida.

**O que NÃO dá para dividir agora, e por quê.** Os dois maiores,
`js/ui/ai_assistant_manager.js` com 3416 linhas e
`js/compilation/compilation_module.js` com 3122, são cada um uma classe só, e uma
varredura em 08/08/2026 não achou neles um único método que não toque em `this`.
Não há núcleo puro para extrair: dividir esses dois significa mover estado e
mudar pontos de chamada, com zero teste embaixo, na véspera de congelar a versão
que vai para trinta máquinas. É a mesma troca que fez a interface definitiva
ficar de fora, e a resposta é a mesma.

O `main/ai/tools.js` também fica. Ele é um vetor de dados, não lógica, e não está
agrupado por assunto: são 25 blocos contíguos para 10 namespaces. Dividir por
namespace mudaria a ordem em que as ferramentas chegam ao modelo, que é mudança
de comportamento sutil, e não destrava teste nenhum, porque o manifesto já é
verificado pelo `tool_manifest.test.js` e pelo gerador da documentação.

**O que destrava.** Para os dois grandes, o caminho é o inverso do que parece:
primeiro cobrir por fora, com teste de ponta a ponta que exercite o painel de IA
e o fluxo de compilação pela interface, e só então mover código por dentro, com a
rede já no lugar. Isso é trabalho do SAPHO seguinte, não desta versão.

---

## 8. Vercel AI SDK na geração 7, ainda sem prova ao vivo

A migração foi feita em 07/08/2026 (PR #52): `ai` de 6.0.184 para 7.0.52 e os
cinco provedores para a geração nova, `@ai-sdk/anthropic`, `@ai-sdk/openai`,
`@ai-sdk/google` e `@ai-sdk/groq` em 4.x, `@ai-sdk/deepseek` em 3.x. O CI passou,
o que cobre lint, tipos e os 645 testes unitários.

**O que falta.** Nenhum provedor foi exercitado de verdade depois da troca. Uma
mudança de comportamento que não apareça na tipagem passa por esse CI sem
resistência, porque não existe teste com provedor real (é o mesmo buraco do item
4). Falta uma conversa completa por provedor configurado e uma chamada de
ferramenta que toque a IDE, com atenção a `createOpenAI`, `createAnthropic`,
`createGoogleGenerativeAI`, `createDeepSeek` e `createGroq`, que
`main/ai/provider.js` carrega por `tryRequire` nas linhas 51 a 55.

**Por que ela teve de ser feita de uma vez.** O núcleo `ai` fixa a versão da
interface: o 6 dependia de `@ai-sdk/provider` 3.0.10, o 7 depende de 4.0.7. Cada
provedor é compilado contra uma delas. Subir um provedor sozinho instalaria duas
cópias da interface e entregaria ao núcleo um objeto de modelo que ele não sabe
consumir, falhando em execução com o CI verde. Foi o que os PRs #50, #41 e #43
propunham separadamente, e por isso foram fechados. O `.github/dependabot.yml`
ganhou o grupo `ai-sdk` juntando `ai` e `@ai-sdk/*`, e foi ele que produziu o #52
com a família inteira. A regra fica: essa família nunca sobe em pedaços.

---

## 9. Depois do laboratório: capacidades e fundação

Esta seção veio do `ROADMAP.md`, que foi removido em 07/08/2026 por duplicar este
documento. O backlog passa a ser um só, e o que segue é o que vem depois de os
itens acima estarem resolvidos. É de propósito grosso: prioridade muda conforme a
necessidade do laboratório.

**C++ como segunda linguagem de processador**, ao lado do C±. O front end do yanc
já existe, `cpppp` mais `cppcomp`, e converge no mesmo assembly, então o trabalho é
integração do lado da AURORA mais um painel próprio de criação de processador C++.
Vale a regra do §13 do [ARCHITECTURE.md](../ARCHITECTURE.md): toda capacidade sai
como API chamável pela IA antes de sair como botão. Plano e inventário de lacunas
em [ESTUDO_CPP_PROCESSADORES.md](ESTUDO_CPP_PROCESSADORES.md).

**Processo de IA persistente por conversa**, para matar o arranque frio da CLI a
cada turno, e aposentar os caminhos antigos de spawn quando os motores de SDK
tiverem rodagem.

**Surfer embutido**, saindo de opção para padrão. Hoje ele é janela externa como o
GTKWave; embutir depende de um bundle WASM que o projeto de origem não publica em
formato baixável, e isso está registrado como bloqueado.

**Terminar a migração da casca para Lit**, levando abas, árvore, terminal e barra
de estado para declarativo, com o editor como hospedeiro. Conversa com o item 2.

**Multiplataforma**, avaliando Linux e macOS, hoje impedido porque a toolchain
empacotada é só de Windows.

---

## O plano

Escrito em 08/08/2026. A meta é uma só: fechar a versão definitiva, assinada, que
vai para o laboratório de DLP e depois entra em manutenção. Nada fora desta lista
entra no projeto; capacidade nova é escopo do SAPHO seguinte, e está no item 9.

O plano tem duas trilhas porque metade do trabalho depende de máquina limpa, do
painel da SignPath e de você usando a IDE, e a outra metade não depende de nada.
As duas correm em paralelo, e nenhuma espera a outra.

### Trilha A, que não depende de ninguém

Executada de cima para baixo, sem desvio. Cada passo termina com CI verde.

1. **Rede de testes na fronteira** (item 4). O método é sempre o mesmo: extrair
   a lógica pura que está presa dentro dos handlers de `ipcMain`, que é o que a
   torna testável, e escrever teste em cima. Já saíram `project_paths.js`,
   `surfer_config.js`, `files_ops.js` e `git_parse.js`. Continuam sem teste seis
   arquivos de `main/ipc`: `ai.js`, `github_auth.js`, `shell.js`, `system.js`,
   `docs_window.js` e `tree_undo.js`.
2. **Split dos god files** (item 7). É o mesmo movimento do passo 1, continuado
   até os três arquivos grandes caírem. Não é refactor por estética: cada
   extração é o que permite o teste do passo 1 existir.
3. **P6, o único item concreto de performance** (item 3). Trocar `transition:
   width` por `transform` em `css/base/layout.css:160` e
   `css/panels/ai_assistant.css:36` e `:1668`.
4. **Correção dos bugs conhecidos.** O SAPHO tem vários, e eles são a razão de a
   assinatura ficar por último: assinar uma versão que ainda vai mudar gasta o
   ritual à toa. A lista de bugs vem do uso, não de auditoria minha; conforme
   forem aparecendo, entram aqui com o caminho para reproduzir.

   Fica registrado um que ficou pela metade, para ninguém achar que foi visto
   inteiro. O anel de foco que riscava a borda foi medido e corrigido no corpo do
   terminal e na lista de mensagens do chat, mas o Monaco nunca chegou a ser
   medido: a sonda abriu o projeto e não abriu o arquivo no editor, então não há
   medida do que acontece lá. Se a linha continuar aparecendo no editor, o
   caminho é abrir um `.v` de verdade pelo harness e varrer o foco com o Monaco
   montado, e não repetir a varredura com a tela de boas-vindas.
5. **Itens pequenos de código** (item 6): mídia real do README. A fonte saiu
   daqui em 08/08/2026, trocada por Metamorphous e Noto Sans Runic, as duas OFL.
6. **Fechar a documentação**: conferir o `DESIGN.md` contra o CSS, revisar
   `SECURITY.md` e `THIRD_PARTY_NOTICES.md`, e reconferir os três estudos
   temáticos que sobraram, que são de julho e não foram revalidados.
7. **Assinatura no `release.yml`** (item 5, a parte de código), por último e só
   quando o resto estiver fechado. O YAML pronto está no
   [CODE_SIGNING.md](CODE_SIGNING.md) e o `scripts/patch-latest-yml.js` já
   existe. Entra condicionada à existência do token, degradando para build não
   assinado, conforme a restrição já decidida.

### Trilha B, que depende de você

8. **Painel da SignPath**: resolver a política `release-signing`, criar a
   Artifact Configuration, decidir o modelo de aprovação e criar as contas
   individuais. Detalhes no item 5.
9. **Release definitiva**, quando a trilha A fechar.
10. **Ensaio de atualização em máquina limpa** (item 1). É o passo que a frota do
   laboratório não pode ser a primeira a fazer.
11. **Verificação ao vivo** (itens 4 e 8), na mesma máquina: uma conversa
    completa por provedor de IA configurado e uma chamada de ferramenta, instalar
    e remover uma biblioteca no PyLibs, e um ciclo de git de ponta a ponta.

### O que fica de fora, e por quê

A interface definitiva (item 2) e o resto do item 9 não entram. Redesenhar a
interface às vésperas de congelar a versão que vai para trinta máquinas troca
risco conhecido por risco desconhecido, sem ganho para a aula. Vão para o SAPHO
seguinte.
