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
que vai ser instalada no laboratório. O PR #12 (`chore(main): release 6.4.0`)
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

## 2. Interface definitiva (o Nível 4 do plano original)

Pedido na primeira mensagem da sessão e **não iniciado**. Nenhuma linha de UI
foi tocada. As quatro sessões foram gastas em pipeline de release, updater,
empacotamento e auditoria funcional, porque a cada etapa apareceram bugs reais
que valiam mais.

O que existe de insumo: o estudo consolidado de interface na §15 do ESTUDO
(sistema de botões e cards, tokens de painel) e a migração da casca para Lit,
~40% feita, com o inventário de componentes na §17.

Não há decisão tomada sobre escopo. Antes de começar, vale definir se a "versão
definitiva" significa consolidar o que existe ou redesenhar.

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

Um item concreto sobreviveu à conferência de 07/08/2026 e continua aberto:
`transition: width` anima propriedade de layout, o que força relayout de todos os
editores Monaco a cada alternância de painel. Restam três ocorrências, em
`css/base/layout.css` linha 160 e em `css/panels/ai_assistant.css` linhas 36 e
1668. A correção é animar `transform: translateX` num invólucro de largura fixa,
nunca a largura em si.

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
- **Fonte Norse**: hoje vem do dafont no bootstrap, que é o único download fora
  de GitHub/GitLab e o mais sujeito a bloqueio de rede institucional. A licença
  permite embutir no app mas **proíbe** redistribuir, então não pode ser
  commitada (§19.6). Para eliminar a dependência: pedir permissão escrita ao
  autor, ou trocar por uma fonte rúnica sob SIL OFL.
- **Mídia real do README**: os GIFs continuam sendo scaffold.
- **Submissão do instalador ao Microsoft Security Intelligence portal**, pela
  TI do laboratório, quando houver instalador definitivo. É a ação de maior
  efeito contra o SmartScreen e não depende da assinatura estar pronta
  ([IMPLANTACAO_LABORATORIO.md](IMPLANTACAO_LABORATORIO.md) §4.4).

---

## 7. Split dos god files

Três arquivos concentram 3478 linhas e continuam crescendo: `main/ai/tools.js`
com 1532, `main/ipc/project.js` com 982 e `main/ipc/prism.js` com 964. Nenhum
deles tem divisão interna por assunto, e cada funcionalidade nova de IA, de
projeto ou de PRISM entra empilhando no mesmo lugar.

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

**O caminho, quando for a hora.** Refazer a divisão sobre a main do dia, usando
a tag apenas como mapa de qual função vai para qual módulo. É refactor mecânico
com os testes atuais como rede, e cabe em três commits, um por arquivo. Não
depende de nada e não bloqueia nada, mas quanto mais tarde, maior o arquivo.

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

## Ordem recomendada

1. **Ensaio de atualização** (item 1). Valida a promessa central e exige
   justamente a máquina limpa que já está sendo preparada. É o teste que a frota
   do laboratório não pode ser a primeira a fazer.
2. **Verificação ao vivo das áreas do item 4**, aproveitando a mesma máquina.
3. **Assinatura** (item 5), conforme os slugs forem existindo. Não bloqueia o
   uso em laboratório, já que o documento de implantação cobre Defender e
   AppLocker sem ela.
4. **Interface e performance** (itens 2 e 3), com calma, já que o release
   definitivo não tem pressa.
5. **Split dos god files** (item 7), quando houver folga entre funcionalidades.
   É o único item que fica mais caro a cada semana que passa, porque os três
   arquivos crescem junto com o resto.
