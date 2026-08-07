# O que falta

Backlog honesto do que ainda não foi feito para a AURORA/SAPHO entrar no
laboratório de Dispositivos Lógicos Programáveis. Escrito em 06/08/2026, ao
fim da sessão de preparação registrada em
[ESTUDO_COMPLETO_AURORA.md](ESTUDO_COMPLETO_AURORA.md) §19.

A regra deste documento: só entra aqui o que **não** foi feito. O que foi feito
está no §19. Ao concluir um item, mova o registro para lá e apague daqui.

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

**O ensaio, em ordem:**

1. Merge do PR de release da v6.4.0 (aberto desde 29/07). Isso publica a
   release no `aurora`, que dispara o `release.yml`, que constrói e publica o
   instalador em `nipscernlab/sapho`.
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

Recomendação: medir antes de mexer. A §4 foi escrita em junho e vários itens
podem já ter sido resolvidos pelas otimizações registradas na §17.

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

**Efeito colateral a comunicar:** o primeiro release assinado será download
completo para todo mundo, porque a assinatura invalida todos os blocos do delta.
Depois dele, volta ao incremental.

---

## 6. Itens externos, pequenos

- **Merge do PR de release v6.4.0**, aberto desde 29/07. É o gatilho do ensaio
  do item 1.
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
