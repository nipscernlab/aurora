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

- [x] ~~Merge do PR #63 e publicação da 6.4.0.~~ Feito em 11/08/2026. Está em
      `nipscernlab/sapho` com os três assets, e o portão de integridade conferiu
      por fora, como um cliente faria: 525 MB, sha512 batendo, blockmap
      presente, e 79 mil caracteres de changelog espelhados.

      O pipeline nunca tinha rodado inteiro, e quatro defeitos só apareceram
      aqui, todos corrigidos. A verificação da toolchain procurava `surfer.exe`
      quando o binário do fork é `surfer-aurora.exe`. O Verilator quebrava no
      runner porque o `os.tmpdir()` de lá volta em formato curto 8.3 e o til não
      sobrevive ao Perl do msys. O electron-builder publicava num repositório
      diferente do que constrói, subiu o instalador e morreu antes do
      `latest.yml`, deixando uma release publicada e inútil, que é quase
      certamente a razão de a v6.3.2 ter ido à mão. E o portão que confere o
      feed lia o `latest.yml` como bytes, então acusava divergência num arquivo
      correto e ainda mandava apagar a release.
- [x] ~~Instalar a 6.4.0 na máquina do LABEL e rodar o roteiro da seção 2.7.~~
      Superado em 22/08/2026: o SAPHO está instalado em TODAS as máquinas do
      LABEL, e numa versão bem posterior à 6.4.0. Falta confirmar o roteiro da
      2.7 em cada uma, que é verificação e não instalação.
- [x] ~~Fazer uma alteração trivial, mergear o novo PR de release, publicar a
      6.4.1.~~ Feito, e muitas vezes: da 6.4.1 à 6.9.0 saíram nove releases
      pelo mesmo caminho, todas com tag no repositório. O passo do ensaio que
      ainda falta não é publicar, é OBSERVAR uma dessas atualizações chegar
      sozinha numa máquina do LABEL, que é o item seguinte.
- [x] ~~Abrir o app na máquina do LABEL e observar o ciclo inteiro.~~ Feito em
      26/08/2026: o Chrysthofer implantou no LABEL e viu a atualização
      acontecer. Isto fecha o risco que a seção inteira existia para cobrir, e
      que nenhuma evidência de fora do laboratório alcançava: perfil sem
      privilégio, AppLocker sobre `%LOCALAPPDATA%`, proxy da universidade e
      Defender corporativo, todos no caminho ao mesmo tempo.

      O detalhe abaixo era o roteiro do ensaio e fica como registro do que foi
      observado. A notícia de 22/08/2026, de que TODOS os alunos viram
      a atualização funcionar nos laptops de casa. Essa evidência vale muito e
      derruba a hipótese mais provável, a de um defeito no próprio updater, mas
      não cobre o que é específico do laboratório: perfil sem privilégio,
      AppLocker restringindo `%LOCALAPPDATA%`, proxy da universidade e o
      Defender corporativo. É justamente ali que a atualização silenciosa falha,
      e falharia em trinta máquinas ao mesmo tempo. O ciclo a observar:
  - a checagem silenciosa dispara ~6 s após o boot e a janela de atualização
    aparece com o changelog preenchido; corpo vazio significa que o
    espelhamento de release notes falhou;
  - o download é incremental, e dá para medir acompanhando os MB transferidos
    na própria janela contra os ~140 MB do instalador completo;
  - fechar o app aplica a atualização em silêncio, sem elevação, e a próxima
    abertura mostra a 6.4.1 com o toast de confirmação;
  - Configurações > Sobre > Atualizações reflete o que aconteceu.
- [ ] Resiliência: derrubar a rede no meio do download e confirmar que a janela
      mostra a contagem regressiva e retoma sozinha, em vez de congelar a barra.
      NÃO foi coberto pelo ensaio de 26/08, que viu o caminho feliz. É o único
      pedaço do ensaio do updater que continua por fazer, e agora é um teste
      isolado, não mais um bloqueio para a frota.
- [x] ~~Passando tudo, liberar a implantação na frota (seção 2).~~ Liberada e
      executada em 26/08/2026.

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

Desde a v6.5.0 o instalador abre mostrando a licença (LICENSE + anexo SAPHO,
gerados a cada build por `scripts/gen-installer-license.js`) e só instala se o
usuário aceitar. A página é só um portão de leitura: não muda a elevação nem o
diretório, e tudo acima continua valendo.

| Item | Valor |
|---|---|
| Diretório do programa | `%LOCALAPPDATA%\Programs\SAPHO\` (executável `SAPHO.exe`) |
| Dados e logs | `%APPDATA%\SAPHO\` |
| Cache do atualizador | `%LOCALAPPDATA%\sapho-updater\` |
| Toolchain | `%LOCALAPPDATA%\Programs\SAPHO\components\` |
| Disco por usuário | ~2,3 GB em repouso, ~3,3 GB durante uma atualização (medido em 14/08/2026) |
| Rede | HTTPS para `github.com` e `objects.githubusercontent.com`, nenhuma obrigatória para compilar |

O que costuma travar: a IDE executa compiladores a partir do perfil do usuário,
e políticas do tipo "bloquear execução fora de Arquivos de Programas" impedem o
funcionamento mesmo com a instalação bem-sucedida. Os binários são um conjunto
fechado por allowlist em [main/compile/binary_allowlist.js](main/compile/binary_allowlist.js):
compiladores SAPHO (`cmmcomp`, `appcomp`, `asmcomp`, `cppcomp`, `cpppp`),
Icarus (`iverilog`, `vvp`), Verilator com `g++`/`make`/`perl`, Yosys, GTKWave,
Python 3.12, e as ferramentas de linguagem (`verible-verilog-ls`,
`slang-server`, `clang-format`). Qualquer binário fora dela é recusado.

Em 22/08/2026 o SAPHO foi instalado em todas as máquinas do LABEL e a cadeia de
compilação rodou inteira lá dentro. Isso é a prova que faltava para o risco
principal desta seção: os compiladores executam a partir do perfil do usuário,
então nenhuma política do tipo "só executa em Arquivos de Programas" está
barrando o caminho do programa nem o de `components\`, inclusive o
`components\Temp\` que o Verilator usa para o binário que compila na hora.

O terceiro caminho, `%LOCALAPPDATA%\sapho-updater\pending\`, saiu do escuro em
26/08/2026: a atualização foi observada funcionando no LABEL, e ela só termina
executando o instalador de lá. Com isso os três caminhos de execução desta
seção estão provados em campo, e o laboratório pode ser atualizado sem visita,
que era a promessa que o projeto fez.

- [x] ~~**2.1 Decidir o modelo de implantação.**~~ Resolvido na prática em
      26/08/2026: a implantação foi feita e a atualização chegou, então o perfil
      não é descartado no logoff e a instalação por usuário se sustenta.
- [ ] **2.2 Exclusões do Defender**, agora sabidamente uma questão de tempo e
      não de funcionamento: a compilação roda no LABEL com o que estiver
      configurado hoje. Sem elas o efeito é lentidão, não bloqueio:
      uma compilação com Verilator gera centenas de intermediários, e cada um
      passa pela varredura em tempo real. Por GPO, ou por PowerShell
      administrativo em cada máquina:

      Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\SAPHO"
      Add-MpPreference -ExclusionPath "$env:APPDATA\SAPHO"
      Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\sapho-updater"

      A terceira evita revarrer o instalador de ~140 MB a cada atualização.
- [x] ~~**2.3 Regras AppLocker/SRP**, o ponto crítico.~~ Fechado em 26/08/2026: os três caminhos executam no LABEL. Com a regra padrão de
      permitir execução só em `%ProgramFiles%` e `%SystemRoot%`, nada dentro de
      `%LOCALAPPDATA%` executa. São necessárias duas exceções por caminho:

      %LOCALAPPDATA%\Programs\SAPHO\*
      %LOCALAPPDATA%\Programs\SAPHO\components\*
      %LOCALAPPDATA%\sapho-updater\pending\*

      A segunda é indispensável e é a que costuma ser esquecida: sem ela a IDE
      abre normalmente e só falha ao compilar, com erro que parece bug da
      aplicação. O diretório `components\Temp\` também precisa permitir
      execução, por causa do executável que o Verilator compila na hora.

      Em 22/08/2026 as duas primeiras ficaram provadas na prática: a cadeia de
      compilação rodou inteira nas máquinas do LABEL, o que só acontece se a
      execução a partir do perfil estiver liberada.

      A terceira também ficou provada, em 26/08/2026, quando a atualização foi
      vista acontecendo no LABEL: ela termina executando o instalador baixado
      para `%LOCALAPPDATA%\sapho-updater\pending\`, então esse caminho executa.
      Era o risco de a atualização baixar os ~140 MB, validar o hash e morrer
      calada no último passo, deixando a máquina na versão velha para sempre.
- [ ] **2.3.1 Não instalar com "Executar como administrador".** O instalador é
      por usuário e sem elevação, de propósito. Rodado sob uma conta de
      administrador, ele instala no perfil daquela conta: o aluno faz login
      depois e não encontra nada, e o atalho aponta para um caminho que não é o
      dele. A senha de administrador serve para criar a exceção de política na
      máquina, não para rodar o instalador. Quem executa o instalador é a conta
      que vai usar o programa.

      Se a exceção não for possível e a única saída for instalar para todos, o
      instalador precisa virar `perMachine`, e a consequência tem que ser
      aceita antes: em `%ProgramFiles%` toda atualização passa a exigir
      elevação, ou seja, um administrador presente em cada máquina a cada
      versão. É exatamente a promessa que este projeto fez para não fazer.
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
      algumas dezenas de máquinas nunca geram.

      QUANDO submeter, decidido em 22/08/2026: só a partir do primeiro
      instalador assinado. Reputação de SmartScreen se acumula no certificado,
      e um envio sem assinatura constrói no máximo algo preso ao hash daquele
      arquivo, que evapora na versão seguinte. A exceção é falso positivo: se o
      Defender começar a barrar ou colocar em quarentena, submeter na hora,
      porque aí o assunto é o arquivo e não o publicador. Até hoje isso não
      aconteceu em nenhuma máquina do LABEL.
- [x] ~~**2.7 Roteiro de verificação.**~~ Os quatro passos passaram no LABEL até 26/08/2026. Repetir em cada máquina nova continua sendo bom hábito, não pendência. Falhando algum
      passo, o problema é quase sempre o 2.3. Em 22/08/2026 os passos 1 a 3
      passaram no LABEL, com a cadeia de compilação rodando inteira; sobra
      confirmar o passo 4 e repetir a passagem em cada máquina, não só nas que
      já foram usadas.
      1. ~~A IDE abre e mostra a tela inicial.~~
      2. ~~Abrir um projeto de exemplo e compilar, sem erro (exercita os
         compiladores SAPHO).~~
      3. ~~Executar a simulação e abrir as formas de onda (exercita
         Icarus/Verilator, GTKWave e a execução a partir de `components\Temp\`).~~
      4. ~~Configurações > Sobre > Atualizações não deve dizer que não alcança o
         servidor.~~ Coberto em 26/08/2026: a atualização chegou e foi aplicada,
         o que exige alcançar o servidor.
- [ ] **2.8 Conferir disco e proxy.** O updater usa a configuração de proxy do
      sistema (Electron/Chromium). O disco é a conta que precisa ser feita
      antes, porque no LABEL cada aluno tem perfil próprio e a instalação é por
      perfil: o mesmo SAPHO cabe uma vez para cada aluno que usar aquela
      máquina. Medido em 14/08/2026, numa instalação real:

      | | |
      |---|---|
      | `%LOCALAPPDATA%\Programs\SAPHO` | 2135 MB |
      | `%APPDATA%\SAPHO` (dados, logs) | 153 MB |
      | `%LOCALAPPDATA%\sapho-updater` | até 1051 MB durante uma atualização |

      São ~2,3 GB em repouso e ~3,3 GB no pico, por aluno, por máquina. Trinta
      alunos numa máquina são cerca de 70 GB. O pico é o dobro do instalador
      porque o electron-updater mantém o arquivo baixado em `pending\` e uma
      cópia em `installer.exe` para aplicar na saída; some depois de instalar.

      Se a conta não fechar, a saída não é instalar em `%ProgramFiles%` sem
      pensar: ali toda atualização passa a pedir elevação, e a promessa de
      atualizar sem visita morre. Ver 2.3.1.

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
exploração comercial, contrariando o item 6 da Open Source Definition.

A previsão se confirmou. O e-mail sobre a troca de licença foi enviado em 19/08
e o Phillip respondeu, registrado aqui em 22/08/2026, com três frases que
decidem o resto da seção: para o programa da Foundation o projeto precisa estar
sob licença aprovada pela OSI; a MIT servia e a NIPS-CERN 1.1 não pode ser
aceita automaticamente; eles vão revisar internamente. E uma quarta que dá
folga: "You can still do signings", ou seja, a conta continua servindo com o
certificado de teste enquanto a revisão corre.

A DECISÃO, tomada em 22/08/2026: assinar agora com o que a SignPath já liberou,
esperar a revisão interna deles sobre a licença, e seguir a orientação que
vier. Não se muda licença por antecipação, nem se compra certificado antes de
saber se será preciso.

Isso reordena a seção. O que estava travado esperando a licença passa a ser o
plano B, e o caminho principal é o operacional, que não depende de decisão
nenhuma: fechar o setup do painel, assinar com o certificado de teste, publicar
a página de política de assinatura. Tudo isso é exigido nos dois desfechos, e é
exatamente o que o Phillip liberou ao escrever "You can still do signings".

Sobre o SmartScreen, para calibrar a expectativa de quem for validar: o aviso
não some no dia em que a primeira release assinada sair. O que a assinatura
constrói é reputação acumulada no certificado do publicador, e ela chega com o
tempo e com downloads; as primeiras instalações assinadas ainda podem avisar.
Isso é esperado e não é sinal de problema no certificado.

O caminho operacional que o Phillip descreveu: criar projeto e Artifact
Configuration (o GitHub entrega o artefato num zip, e a configuração é
zip-file com pe-file dentro, o CONTRÁRIO do que o 3.5 assumia), configurar o
Trusted Build System, assinar com o certificado de teste autoassinado, e só
depois da revisão deles vem o certificado de produção. O modo que faltava no
release.yml, construir e assinar SEM publicar, entrou em 22/08/2026 como a
entrada `sign_only` do `workflow_dispatch`: ela constrói, assina, guarda o
instalador como anexo da execução para conferência e pula os três passos que
falam com o canal de distribuição. O certificado de teste é autoassinado e o
instalador que ele produz não pode ir para os alunos.

Vale saber, para não gastar dinheiro à toa: certificado EV deixou de dar
reputação instantânea no SmartScreen em março de 2024, então OV e EV se
comportam igual hoje e o certificado gratuito da SignPath é a melhor opção
disponível, não um consolo. O que a assinatura compra de verdade é a reputação
acumulada no certificado do publicador, herdada pelas releases seguintes.

- [x] ~~**3.1 Resposta da SignPath.**~~ Chegou, registrada em 22/08/2026: a
      Foundation exige licença aprovada pela OSI, a MIT servia, a NIPS-CERN 1.1
      não é aceita automaticamente, e há revisão interna em curso. Assinar com
      o certificado de teste segue liberado.
- [ ] **3.1.1 Responder ao Phillip pedindo a emissão do certificado de
      produção.** Decidido em 22/08/2026, depois do ensaio. Não é forçar a
      revisão da licença: é o passo seguinte no procedimento que ele mesmo
      descreveu no primeiro e-mail, que era assinar com o certificado de teste
      e avisar quando estivesse tudo pronto, para eles revisarem a configuração
      e encomendarem o certificado de verdade.

      O que contar na mensagem, tudo verificável do lado deles: a Artifact
      Configuration está criada e válida, o `CI builds` submete pela política
      `test-signing`, a requisição 432e4179 saiu do commit `eba504a` em `main`
      pela integração do GitHub, e o instalador voltou assinado, com carimbo de
      tempo da DigiCert, cadeia terminando em raiz não confiável como é
      esperado de certificado de teste. A página pública de política de
      assinatura está no ar em nipscern.com/code-signing, que é pré-requisito
      deles.

      Mencionar que a revisão da licença segue em aberto e que vocês aguardam a
      orientação, sem pedir desfecho. As duas coisas correm em paralelo, e
      misturá-las só atrasa a que já está pronta.

- [ ] **3.2 Decidir as bases de licença** com o orientador e, pela Lei de
      Inovação, provavelmente com o NIT da UFJF. Desde 22/08/2026 isto NÃO
      trava mais a assinatura: a decisão é esperar a orientação da SignPath e
      segui-la. O que está abaixo continua valendo como a proposta já estudada,
      pronta para quando a resposta chegar, e não como movimento a fazer agora.
      A proposta: AURORA em EUPL-1.2 (ou Apache-2.0, se quiserem
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
- [x] ~~**3.5 Painel da SignPath.**~~ Feito em 22/08/2026, e o ensaio rodou de
      ponta a ponta na execução #17 do `release.yml`. Ficou provado, de uma vez:
      o token do `CI builds` funciona, ele tem permissão de submeter, a
      configuração de artefato casa com o zip que o GitHub entrega, o curinga do
      nome acha o instalador, a SignPath devolve o arquivo assinado, e o
      `patch-latest-yml.js` refaz o manifesto e o blockmap a partir dos bytes
      assinados. O `Get-AuthenticodeSignature` no anexo confirmou assinatura
      Authenticode, carimbo de tempo da DigiCert, e a cadeia terminando numa
      raiz não confiável, que é o desfecho correto para certificado de teste.

      Valores em uso: organização `f709b0ef-a08f-4cbb-ae62-60d18e4f96a2`,
      projeto `aurora`, configuração `initial`, política `test-signing`. Os três
      primeiros não mudam; o último vira `release-signing` quando o certificado
      de produção sair.

      Não foi preciso decidir modelo de aprovação: a `test-signing` já vinha com
      `Use approval process` desligado e com o `CI builds` entre os submitters.

- [ ] **3.5.1 Ligar as garantias na política de produção.** A `test-signing`
      está com `Require trusted build system` e `Verify origin policy`
      desligados, o que é aceitável num ensaio. Na `release-signing` os dois
      precisam ficar LIGADOS, porque são eles que tornam verdadeira a frase da
      página pública de que uma requisição só carrega o que o fluxo do projeto
      construiu. Sem isso, a página promete uma garantia que o painel não
      impõe.

- [x] ~~**3.6 Escrever a página pública de Code signing policy.**~~ Feita em
      22/08/2026, no repositório `nipscernweb`, em `nipscern.com/code-signing`
      e ligada no rodapé de todas as páginas. Conta a cadeia como ela é:
      revisão, etiqueta, build do fluxo público a partir daquele commit,
      submissão à SignPath, aprovação humana, publicação. Lista os três papéis
      com nome, e diz as duas coisas que surpreendem quem confere: o publicador
      exibido será SignPath Foundation, e o SmartScreen só acumula reputação
      com o tempo. Inglês e português completos; francês e norueguês caem no
      inglês do HTML, que é como o carregador do site se comporta.

- [x] ~~**3.7 Ligar a assinatura no `release.yml`.**~~ Feito em 11/08/2026. O
      workflow tem dois caminhos escolhidos pela existência do
      `SIGNPATH_API_TOKEN`: sem o secret, o build publica sem assinatura
      exatamente como antes, então commitar isso não mudou nada nas releases de
      hoje. Com o secret, ele constrói sem publicar, submete à SignPath, troca o
      instalador pelo assinado, refaz o manifesto e publica.

      Duas correções entraram junto, e as duas só apareceriam na primeira
      release assinada. O `patch-latest-yml.js` apagava o `.blockmap` em vez de
      refazê-lo, o que tornaria toda release assinada um download completo de
      ~140 MB para o laboratório inteiro, não só a primeira; e o portão de
      integridade do próprio workflow exige o `.blockmap` entre os assets, então
      a release teria falhado no último passo. Agora o blockmap é reconstruído a
      partir dos bytes assinados com a implementação do próprio electron-builder
      (`buildBlockMap`), o que foi verificado num ensaio: o mapa antigo descrevia
      8388608 bytes e o novo descreve os 8392704 do arquivo assinado.

      Fechado em 22/08/2026. O secret e as três `vars` existem, os nomes dos
      inputs foram conferidos contra o `action.yml` publicado da action, e o
      ensaio provou o caminho inteiro.

      Duas coisas entraram junto e valem ser lembradas. A espera pela
      assinatura subiu de 600 s para uma hora, porque o programa gratuito exige
      aprovação humana e uma release feita fora do horário de quem aprova
      falharia sozinha, deixando a tag publicada sem instalador. E uma execução
      que publica não assina enquanto a política for a de teste: sem isso,
      bastaria a variável ficar em `test-signing` depois de um ensaio para a
      próxima release de verdade sair assinada com certificado autoassinado,
      que é PIOR do que não assinada.

      Corrigido em 25/08/2026, ao preparar a 6.10.0. Isso era uma trava que
      derrubava o job no primeiro passo, e o efeito não era o pretendido: com o
      segredo criado em 22/08 e a variável ainda na política de teste, QUALQUER
      release de verdade morria ali, e mesclar a PR de release deixaria a tag
      publicada sem instalador, que é justamente o desfecho contra o qual o
      workflow foi desenhado. A trava nunca chegou a rodar, porque o ensaio de
      22/08 foi às 15:37 e ela entrou às 16:02 do mesmo dia. Agora a decisão
      mora numa variável `SIGN` no bloco `env` do job, credencial presente e
      destino em que a assinatura seja aceitável, e a política de teste faz a
      release sair sem assinatura, com aviso no log, em vez de não sair.

      Plano B, se a submissão pela action se mostrar chata: o hook `win.sign` do
      electron-builder pode chamar a SignPath de forma síncrona durante o build,
      e aí o `latest.yml` e o `.blockmap` já nascem dos bytes assinados, sem
      remendo depois. Custa um cliente REST próprio e não é o caminho
      documentado pela SignPath.
- [ ] **3.8 Verificar o primeiro release assinado**: `signtool verify /pa`
      passando, o updater aceitando o instalador sem erro de checksum, e o
      SmartScreen deixando de dizer "unknown publisher".

      O ensaio de 22/08/2026 já cobriu a mecânica com o certificado de teste: o
      `Get-AuthenticodeSignature` no anexo da execução #17 mostrou assinatura
      Authenticode, carimbo de tempo da DigiCert e a cadeia terminando numa raiz
      não confiável, que é o desfecho correto para certificado autoassinado. O
      que resta verificar de verdade é só o que muda com o certificado de
      produção: a corrente fechando numa raiz do Windows, e o comportamento do
      SmartScreen ao longo do tempo.

      Quando o certificado sair, a passagem para produção é curta: a
      `release-signing` deixa de estar INVALID sozinha, liga-se o 3.5.1, e a
      variável `SIGNPATH_POLICY_SLUG` troca de `test-signing` para
      `release-signing`. Enquanto ela não trocar, o `SIGN` do job deixa os passos
      de assinatura de fora em toda execução que publica, então nenhuma release
      sai assinada com o certificado de teste. Avisar a quem valida a
      instalação que o publicador exibido será "SignPath Foundation", não
      NIPS-CERN nem UFJF, porque o certificado é emitido para a Foundation. Isso
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
- [ ] Entrar de um clique no GitLab com conta de verdade: o fluxo de
      dispositivo está provado por teste unitário e o aplicativo OAuth do
      grupo nips-cern está registrado, mas ninguém ainda percorreu o ciclo
      completo (código na tela, autorização no navegador, ficha e foto na
      barra). O mesmo dia trouxe o botão Localizar, o indicador de energia e
      o marcador de tamanho do dump, que também só se confirmam usando: um
      recente movido de pasta reencontrado pela lupa, o ícone vermelho num
      laptop desligado da tomada, e o marcador subindo numa simulação longa.
- [ ] Anel de foco no Monaco: a sonda anterior varreu o foco sem arquivo aberto
      no editor, então não há medida de lá. Abrir um `.v` de verdade pelo
      harness e varrer com o Monaco montado. O corpo do terminal e a lista de
      mensagens do chat já foram medidos e corrigidos.

---

## 5. Melhorias na AURORA

Pós-release, com a regra de sempre: medir antes de mexer.

- [x] **Toolchain como componentes baixados depois da instalação.** Pedido em
      18/08/2026, com o software já em produção, e feito em 19/08/2026. O
      catálogo está em `main/components/registry.js`, o painel em
      Configurações, e o bloqueio de quem tenta usar o que não baixou fica no
      `binary_allowlist`, o ponto por onde botão, API, IA e servidor de
      linguagem já passavam antes de nascer um processo. MSYS e YANC ficaram
      marcados como essenciais e continuam no instalador: sem eles não se
      compila, e não compilar não é uma AURORA reduzida, é uma AURORA quebrada.

      Falta o passo que de fato encolhe o instalador, que é tirar do
      `extraResources` do electron-builder o que agora é opcional. É o passo
      com mais consequência de todos, porque uma release que sai sem os
      componentes e sem o download funcionando na máquina do aluno deixa todo
      mundo sem ferramenta. Antes dele: verificar hash do que foi baixado e
      permitir retomada de download interrompido, que numa rede de laboratório
      acontece.

- [x] ~~**Estimativa do instalador componentizado.**~~ Deixou de ser
      estimativa em 20/08/2026: o instalador saiu de ~542 MB para ~140 MB
      (commit `815faeff`), e o `extraResources` do package.json passou a
      excluir todos os pacotes opcionais, que agora são baixados pelo painel.
      A medida de 18/08 que originou o item, msys 955 MB, gtkwave 88, surfer
      43, tree-sitter 25, slang 8, verible 3, clang-format 3 e dist 109, ficou
      dentro da faixa prevista de 130 a 160 MB.

- [x] **Report de bug em um clique, de dentro da AURORA.** Feito em
      19/08/2026. O painel está em `js/ui/bug_report_form.js`, a coleta em
      `main/ipc/bug_report.js` e o Worker em
      `nipscernweb/workers/sapho-bugreport.js`. O texto de consentimento diz
      exatamente o que vai junto, e o diagnóstico fica visível na tela antes de
      enviar, vindo da mesma função que o envio usa. Falta o Chrysthofer criar
      o token e registrar a rota `nipscern.com/api/sapho/bugreport`; até lá o
      envio falha e cai no e-mail, que continua funcionando.

      Descrição original, mantida porque explica o desenho:

  > **Report de bug em um clique, de dentro da AURORA.** O caminho por
  > e-mail existe e fica como reserva, mas exige conta aberta e vontade. A
  > proposta: um botão que junta sozinho o diagnóstico e o fim do main.log e
  > envia para um Worker do Cloudflare (a infra já existe no nipscernweb),
  > que cria uma issue num repo privado com um token guardado no próprio
  > Worker. O aluno não precisa de conta em nada, o relato chega estruturado,
  > e o limite de tamanho e de frequência fica no Worker.

- [x] ~~**Suporte a GitLab no Git-D.**~~ Pedido em 18/08/2026, feito em
      23/08. Conta por token pessoal, com a instância junto (o grupo nips-cern
      vive no gitlab.com, mas uma universidade pode subir a própria), listar e
      criar projeto, e o painel mostra as duas contas ao mesmo tempo, porque o
      laboratório vive nas duas e obrigar a escolher seria obrigar a
      desconectar para trocar. A lista de clonar mistura as duas origens
      ordenada por atividade, com selo dizendo de onde cada linha vem.

      As duas contas têm o MESMO bloco, sem hierarquia: um renderizador só,
      parametrizado pela forja. A primeira versão dava botão grande ao GitHub e
      link de texto ao GitLab, o que dizia ao usuário qual a AURORA prefere;
      ela não prefere nenhuma, e a escolha é de quem usa.

      O fluxo de dispositivo (entrar de um clique) também existe nas duas, com
      as regras da RFC 8628 compartilhadas em `main/ipc/oauth_device.js`. O
      aplicativo do GitLab foi registrado em 23/08 e o identificador está no
      `gitlab_auth.js`. Conferido ao vivo no mesmo dia, com as duas contas
      conectadas.

      Três correções vieram desse uso, e valem como lembrete: o `tt()` do
      painel não interpolava, e o botão saiu com `{{name}}` cru na tela; a
      barra de baixo mostrava só o GitHub, e agora traz uma ficha por forja,
      sempre as duas, apagada quando desconectada; e o "limpar ao sair" das
      Configurações prometia só o GitHub, embora o processo principal já
      apagasse os dois cofres. Texto que promete menos do que o código faz é
      tão ruim quanto o contrário, porque quem lê decide errado sobre o que
      sobrou na máquina.

      Junto saiu um defeito que já existia: o cabeçalho com o token do GitHub
      era injetado em QUALQUER remoto, então um push para o GitLab levava 401
      num caminho que funcionaria sozinho pelo gerenciador de credenciais. A
      escolha passou a ser pelo host do remoto (`forjaDoRemoto`), e o usuário
      do Basic acompanha, porque o GitLab exige `oauth2` onde o GitHub aceita
      qualquer um. O `github_forget` ganhou os hosts do GitLab e o segundo
      cofre, e a função de casar alvo virou `alvoEhDeForja`, porque o nome
      antigo passou a mentir sobre o que ela decide.

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

      Em 23/08/2026 o método foi aplicado mais duas vezes, sem esperar pelo
      E2E, porque núcleo puro não precisa de rede para ser mexido com
      segurança. Saiu de `renderUsage` o `ai_metadata.usageRows`, com as
      regras que o desenho escondia (utilização recortada em 0 a 100, cor em 90
      e 60, e o `resetsAt` que chega ora em segundos ora em milissegundos), e
      junto o rótulo do plano, que unifica `pro_max` e `claude_max` num MAX
      só. Saiu de `_waveValidateCocotbConfig` o `decideCocotbDut`, que responde
      quem é o dut e devolve o motivo da recusa como código, deixando a
      tradução para o chamador. Vinte e cinco testes novos, e os dois arquivos
      juntos perderam cerca de oitenta linhas. O que sobra neles é orquestração
      de verdade, com disco e IPC no meio, e para essa parte o E2E continua
      sendo o caminho.
- [x] ~~**CRUD da árvore de arquivos**~~, lacunas fechadas em 23/08/2026.
      Seleção múltipla com Ctrl e Shift: a regra de qual clique produz qual
      conjunto é pura (`js/tree/tree_selection.js`), a âncora do Shift é o
      último clique SEM Shift, e cortar, copiar, apagar e arrastar valem para
      tudo que está marcado. O gesto inteiro é UMA entrada na pilha, pela
      forma `grupo` nova no `tree_history.js`, que desfaz ao contrário e
      descarta o membro que falhou. Renomear segue de um só.

      Cursor e rolagem: renomear um arquivo aberto fecha e reabre a aba, e
      isso devolvia o editor na linha 1; agora o `addTab` aceita `viewState`
      e restaura no mesmo lugar em que já restaurava o `revealPosition`, que
      é depois de o editor existir. A rolagem da própria árvore também era
      perdida a cada desenho, porque ele reconstrói as linhas do zero.

      Awareness do `.spf`: renomear, mover ou apagar um arquivo que ele
      referencia arruma o topo de síntese, o topo de simulação e as duas
      listas no mesmo gesto (`js/project/spf_paths.js`), e o Ctrl+Z devolve o
      que foi tirado, inclusive a marca de topo. A pasta de um processador é
      recusada, com a razão na tela: renomeá-la é o primeiro de cinco passos e
      quem faz os cinco é o `renameProcessor`.
- [x] ~~**Consolidar as paletas divergentes.**~~ Feito em 11/08/2026. As três
      janelas tinham derivado para três céus noturnos, o app em `#0A0D14`, o
      splash em `#03060F` e a janela de atualização em `#060A14`, cada uma com
      a sua rampa de texto. As superfícies, o texto e a cor de erro passaram
      para o `brand_tokens.css`, onde os acentos já estavam, e as duas janelas
      isoladas leem de lá. Fechado com uma catraca no CI
      ([scripts/check-design-tokens.js](scripts/check-design-tokens.js)), que
      não exige limpar as 163 cores e 172 durações cravadas de hoje, só que o
      número não suba; quando um arquivo melhora, ela pede que a linha desça.
- [x] ~~**O resto dos estilos, a parte verificável por máquina.**~~ Feito em
      23/08/2026. A catraca desceu de 163 para 57 cores cravadas e de 172 para
      157 durações, e o `git_panel.css` sozinho caiu de 70 para 3.

      A descoberta que explica o tamanho da queda: a maior parte das cores
      cravadas não era cor solta, era RESERVA dentro do próprio `var()`, como
      `var(--status-error, #E26C6C)`. A reserva só valeria se o token não
      existisse, e todos existem, porque o `import.css` carrega
      `theme_variables` (que importa `brand_tokens`) antes de qualquer painel.
      O que ela faz de fato é guardar uma cópia que ninguém atualiza quando a
      paleta muda, que foi exatamente como as três janelas terminaram com três
      céus noturnos diferentes. Saíram as reservas e os hex soltos de valor
      IDÊNTICO a um token.

      O que FICOU, decidido e não por omissão. Cor sem token equivalente fica
      como está: trocá-la pela parecida mudaria o desenho por baixo do pano, e
      são poucas, quase todas texto escuro sobre ficha colorida. As durações
      fora da escala também ficam: 200 ms virar 260 ms seria uma transição
      trinta por cento mais lenta na interface inteira, mudança visível que
      ninguém pediu e que nenhum teste pega. E os espaçamentos de 10, 14 e 18
      px ficam: a escala existe para o ritmo do layout, não para proibir ajuste
      óptico em cromo denso como abas, fichas e barra de estado; uma escala que
      ganha meio degrau a cada aperto deixa de ser escala. Os 74 `!important`
      continuam, e os trinta do `editor.css` continuam presos ao CSS do Monaco:
      só saem com o editor em Shadow DOM.

- [ ] **Os dois vocabulários de token, e a marca.** Os aliases legados ainda
      convivem com os semânticos, e consolidar é mecânico só onde o alias
      aponta para o token equivalente; onde ele carrega valor próprio, é
      decisão de desenho. Junto disto, e antes dele, decidir a marca entre
      SAPHO, AURORA e Dagr, que é o que dá nome ao vocabulário que sobra.
- [x] ~~**Varredura de código morto.**~~ Feita em 11/08/2026. Nenhum arquivo
      órfão, nenhuma dependência sem uso. Dos 175 exports sem consumidor, 37
      existem para o teste alcançar o código, que é o método desta base para
      tornar módulo testável, e 129 são exportação supérflua com o código vivo
      dentro do próprio arquivo. Sobraram nove funções que ninguém chamava, e
      saíram; o lint achou a cascata sozinho, porque sem o `tempRoot` o
      `require('os')` do fetcher ficou sem uso.
- [x] ~~**Aparar as exportações supérfluas.**~~ Feito em 23/08/2026. A lista do
      knip sozinha não autorizava nada: ele não enxerga os testes, que ficam
      fora do `project`, nem as globais do renderer, que não têm aresta de
      importação para seguir. Cada nome dos 233 que ele acusa foi conferido por
      uso real no repositório inteiro, testes incluídos; 67 não apareciam em
      lugar nenhum fora do próprio arquivo e perderam a exportação, com o
      código seguindo vivo lá dentro. Dois não eram superfície e sim código
      morto, e saíram: `aiMarkElement`, irmão em nó de DOM que ninguém monta,
      e `limparSilencio`, que dizia servir aos testes e nenhum teste chamava.

      Ficou decidido NÃO subir `exports` para o `--include` do CI: os 166
      restantes são falso positivo por construção, e uma catraca que acusa
      falso positivo é uma catraca que se aprende a ignorar.
- [ ] **jQuery preso na 3.x pelo digitaljs.** O digitaljs 0.14.2, que desenha a
      simulação interativa do PRISM, declara `jquery: ^3.7.1`. Subir a raiz
      para a 4 instala duas cópias e o digitaljs resolveria a sua própria, sem
      o jquery-ui anexado, trazendo de volta o `e.widget is not a function` do
      commit `52696d9c`. O jquery-ui aceita até a 5, então não é ele o
      obstáculo. Destravar quando o digitaljs publicar suporte, subindo os dois
      juntos e abrindo o modo Simular num design real.

---

- [x] ~~**Monitor da pilha de instrução (isp) no layout.**~~ Pedido em 20/08,
      feito em 23/08. O parser aprendeu a ler `generate if` NOMEADO
      (`js/wave/generate_blocks.ts`), e com isso o caminho
      `core.instr_fetch.isp_blk.isp` passou a existir.

      O que fazia isso ser arriscado era o motivo de o bloco ser descartado:
      o parser não avaliava parâmetros, e capturar as instâncias de dentro
      como se sempre existissem produzia caminho que a elaboração recusa. A
      saída não foi adivinhar, foi resolver: os parâmetros declarados de cada
      módulo, os que a instanciação sobrescreve, e o repasse por nome
      (`.CAL(CAL)`, que é como o `processor.v` desce o valor até o `core`).
      Condição que não dá para decidir continua descartando o bloco, como
      antes: um escopo a menos custa um monitor ausente, um escopo a mais
      custa uma simulação que não elabora.

      Programa C± sem função não tem pilha de instrução, `CAL` fica no padrão
      zero, e nenhum monitor de isp é emitido. Fixado por 29 testes, sendo
      cinco contra o `components/HDL` de verdade, e a suíte de toolchain
      inteira segue verde, incluindo a elaboração no Icarus.

- [ ] **Salvar estado do Surfer de dentro da aba.** Implementação completa
      está no stash "monitores stack/ULA + save-state da aba" (fork já tem o
      comando state_save_url_set publicado na nips.10): o save do cliente WASM
      POSTa o .surf.ron para o servidor local, que grava em
      testbench/<tb>.tab.surf.ron e registra como layout ativo no WaveStore.
      Ficou fora da 6.7.0 pelo congelamento de 20/08; retomar um item por vez,
      com teste do usuário entre eles.

- [x] ~~**Seleção do picker sob Verilator não limita o dump.**~~ Descoberto em
      20/08, fechado em 22/08 em todos os casos. O Verilator ignora os
      argumentos do `$dumpvars`, mas obedece ao `.vlt`, e a granularidade dele
      é o escopo: o pedido do usuário vira regras `tracing_off`/`tracing_on
      -scope` (`js/wave/verilator_trace_rules.js`). Três origens, as mesmas do
      Icarus: a seleção do picker (Wave Configuration ou `.gtkw` ativo), os
      `$dumpvars` do próprio testbench (o gerado pelo yanc cita sinal a sinal;
      referência desconhecida ou chamada sem argumentos desiste e grava tudo),
      e o padrão `$dumpvars(1, tb)`, que passa a valer sob Verilator como vale
      no Icarus. O escopo do testbench, onde vivem os espelhos dos monitores,
      fica sempre ligado. No cocotb o `.vlt` entra pelos argumentos de build,
      porque o runner recusa o arquivo na lista de fontes. Semântica provada
      com doze builds do `mediamovel` no Verilator 5.048 embarcado (caminho
      completo a partir do topo, sem curinga, sem `-levels`, última regra
      vence) e fixada por testes de toolchain com build real nos dois fluxos.
      O modal e o capítulo 14 explicam a regra por escopo.

- [x] ~~**Erro do `$fscanf` que parecia loop de compilação.**~~ Relatado e
      fechado em 23/08/2026. A causa no projeto do usuário era uma
      diretiva `` `define PROJ `` apontando para uma pasta que não existe
      mais, então o `$fopen` devolvia zero e o `$fscanf` reclamava a cada ciclo
      de clock; o terminal
      com milhares de linhas idênticas foi lido como travamento. Os arquivos
      dele foram corrigidos, e vieram três defesas para que a classe inteira
      de erro não volte a se disfarçar de loop.

      A primeira é antes de compilar: `js/wave/fopen_paths.js` lê os `$fopen`
      de leitura do testbench, resolve `` `define `` e concatenação
      (`` {`PROJ, "/x.txt"} ``), e avisa o que não existe no disco. Avisa, não
      bloqueia: caminho montado em tempo de execução é legítimo e recusar
      compilar por heurística seria pior que o erro. A segunda é durante:
      a primeira ocorrência de descritor inválido ganha uma explicação em
      linguagem de gente, uma vez só. A terceira é o terminal, que passou a
      juntar linha repetida consecutiva num contador (`x1000`) em vez de
      empilhar mil nós de DOM, que era o que engasgava a interface.

- [x] ~~**Reencontrar no disco os projetos recentes que sumiram.**~~ Pedido e
      feito em 23/08/2026. A lista já marcava o ausente com risco; faltava o
      caminho de volta para quem só moveu a pasta. Cada linha riscada ganhou
      lupa, e o cabeçalho um "Localizar ausentes (N)", com progresso e
      cancelar. A varredura vive no main (`main/ipc/spf_locator.js`), é uma
      busca em largura com lista de pastas que não entra (`node_modules`,
      `.git`, `Windows`, `$Recycle.Bin`), teto de profundidade e de
      diretórios, e ignora atalho simbólico para não andar em círculo.

      Duas decisões que o código não conta. Uma varredura só atende TODOS os
      alvos ao mesmo tempo, porque quem perdeu uma pasta costuma ter perdido
      várias e varrer o disco uma vez por projeto multiplicaria o custo; os
      achados chegam por evento, à medida que aparecem. E não embutimos o
      Everything nem índice de terceiro: seria dependência nova, com serviço
      e privilégio, para uma busca que roda uma vez a cada muitos meses. A
      escolha do melhor candidato (`spf_locator_rules.js`) é a maior cauda
      comum de caminho, que é o que distingue a cópia certa de um homônimo.

- [x] ~~**Clicar num recente sumido apagava a entrada.**~~ Relatado em duas
      etapas, 23/08/2026. Primeiro o clique estourava `TypeError` porque o
      diálogo de erro nunca tinha sido injetado no gerenciador; depois, com o
      erro visível, apareceu o comportamento errado por trás dele: a sonda de
      existência removia a entrada por conta própria, inclusive quando a
      própria sonda falhava, então um projeto em pendrive desconectado custava
      o atalho inteiro. Agora `checkProjectExists` só responde, o clique
      marca o risco e o diálogo aponta a lupa. Apagar é gesto do usuário, e
      falha genérica de abertura também deixou de apagar.

- [x] ~~**Tamanho do arquivo de onda, ao vivo, em toda compilação.**~~ Pedido
      e feito em 23/08/2026. O dump crescia fora da vista e a única notícia
      era o tamanho final; ver o número subir é o que permite cancelar cedo
      uma simulação que vai encher o disco, e é o que responde "está fazendo
      alguma coisa?" numa corrida longa. Um nó só no terminal do TWAVE,
      atualizado no lugar a cada 700 ms, nos três fluxos (Icarus, Verilator e
      cocotb), que adota o primeiro candidato que aparecer no disco porque o
      nome vem do `$dumpfile` e a extensão muda por simulador. Ele fica no
      terminal depois do fim, como registro da corrida, e o hover mostra o
      caminho completo do arquivo. Tentei fazê-lo desaparecer um minuto
      depois; era o oposto do pedido e foi revertido no mesmo dia.

- [x] ~~**Bateria e velocidade de simulação.**~~ Pedido e feito em
      23/08/2026. Na bateria o Windows corta o clock da CPU, e a diferença
      numa simulação longa é de minutos para meia hora; o aluno não vê a
      causa, vê "a AURORA está lenta". A barra de baixo ganhou indicador de
      energia, verde na tomada e vermelho na bateria, com a porcentagem no
      balão, alimentado pela Battery API do próprio Chromium (máquina sem
      bateria reporta carregando e o indicador fica quieto). O clique explica
      a situação e leva às configurações de energia do Windows. Além disso, a
      tela não apaga enquanto um passo longo da toolchain roda
      (`powerSaveBlocker`, contado por referência).

      O que NÃO fazemos, de propósito: mudar o plano de energia. Mexer na
      configuração do sistema por conta própria é o tipo de surpresa que faz
      um administrador de laboratório desconfiar do aplicativo inteiro. A
      AURORA leva até a porta; a escolha é do dono da máquina.

- [x] ~~**Tags meio-publicadas no registro do fork.**~~ Limpo em 26/08/2026, e o
      levantamento contou outra história. Não eram duas tags: NOVE (nips.1 a
      nips.9) tinham só o exe, e as sete primeiras nunca deveriam ter o bundle
      web, porque o job `publish_wasm` ainda não existia quando saíram. Só a
      nips.8 e a nips.9 foram falha de verdade. A nips.4 ainda tinha QUATRO zips
      de mesmo nome e sha256 diferentes, quatro rebuilds subidos por cima; o
      registro serve o último, os outros eram peso morto.

      O que decidiu o recorte foi checar quais tags alguma AURORA publicada
      chegou a fixar em `download-surfer.js`. Em toda a história do repositório
      são duas: a nips.7 (AURORA 6.4.0 a 6.6.1) e a nips.10 (6.7.0 em diante).
      Apagar a nips.7 daria 404 no doctor de quem ainda estivesse numa 6.4 a
      6.6, então ela ficou. Foram removidos 7 pacotes e os 3 rebuilds antigos da
      nips.4, 152,7 MB; o registro caiu de 10 pacotes para 3, e as três URLs que
      a AURORA usa foram conferidas respondendo depois.

      A regra para a próxima limpeza: antes de apagar qualquer tag, rodar sobre
      as tags do git um `git show <tag>:components/Scripts/download-surfer.js` e
      recolher os `nips.N` citados. O que aparece ali é contrato com máquina
      instalada, não histórico.

      Continua em aberto o mistério do job: por que o zip do runner "adicionava"
      arquivos sem materializar o archive. A nips.10 saiu pelo fallback
      `python3 -m zipfile`, que imprime diagnóstico; na próxima tag, ler esse
      diagnóstico.

- [x] ~~**Clicar num componente do PRISM abre a representação interna dele.**~~
      Pedido e feito em 22/08/2026. A causa era mecânica: o corpo da célula é
      um `<path>`, e o ouvinte genérico de fios o capturava antes de o clique
      chegar ao grupo do módulo, então o nome abria e o retângulo destacava.
      Decisão: a célula inteira abre com um clique; o realce das conexões da
      célula ganhou gesto próprio, Shift+clique, e entrada no menu de contexto;
      duplo clique segue abrindo o fonte; clique num fio solto segue destacando
      só aquele fio. O manual (capítulo 16) descreve os quatro gestos.

      No mesmo dia, duas correções que o uso trouxe. O Shift+clique só acendia
      o `clk`: o netlistsvg põe cada célula num `<g transform>`, e os traços
      da célula estavam em coordenadas locais; a caixa da célula passou a ser
      convertida para o espaço do SVG e todo fio que termina encostado nela
      vira semente. E a etiqueta de barramento (`/32/`) desenhava um retângulo
      de outro tom: era a máscara pintada com `--bg` sobre um canvas que tem
      grade de pontos e vinheta. A primeira tentativa, uma `<mask>` do SVG,
      cortava também o brilho do fio destacado, com borda reta. O que ficou: o
      retângulo sai do DOM e o fio é cortado na geometria, em dois segmentos
      com o mesmo `data-cut-group`, pelo qual o realce atravessa o vão.
      Provado em janela oculta do Electron com o SVG real e o CSS do bundle.

- [x] ~~**Caça a valores fracos de tempo, tentativa e cancelamento.**~~ Pedido
      em 22/08/2026 e fechado no mesmo dia, em dois commits: o relatório
      (`53dece8b`, dezenove achados agrupados pelo que acontece na falha) e as
      correções. Fica aqui o que foi decidido, porque foi decisão de produto e
      o código sozinho não conta o porquê.

      Tabela única de prazos fora da IA em `main/net/timeouts.js`, irmã da de
      `main/ai/timeouts.js`, com autoverificação da hierarquia e teste. Dela
      saem o prazo da API do GitHub, o de ociosidade do git (plugin `timeout`
      do simple-git, zerado a cada byte, então um clone vivo nunca estoura), o
      da extração com o bsdtar e o do Surfer, que passou a ser proporcional ao
      tamanho do dump, com piso de 30 s e teto de 5 min.

      Cancelamento sem botão novo: o instalador de componentes entrou no
      registro de processos (grupo SERVICE, então o Cancelar da compilação não
      o toca, mas o encerramento sim), os extratores também, e o git ganhou um
      sinal de aborto que o `stopAllToolchain` dispara. O fluxo de dispositivo
      do GitHub é cancelável pelo botão do painel, pela janela fechando e pelo
      encerramento.

      O arranque do Monaco tem teto de 30 s e errback no carregador AMD, e o
      splash só libera depois de `EditorManager.ready`; o ARCHITECTURE §7 foi
      corrigido junto, porque afirmava uma garantia que o código não dava.

      O `runCommand` da IA devolve `complete:false` e uma nota quando o teto o
      cortou, em vez de saída truncada idêntica à completa; o teto subiu de 4 s
      para 15 s. Os formatadores dizem por que falharam (`not-installed`,
      `timeout`, `failed`) e o usuário é avisado no `timeout`.

      Esperas fixas que foram trocadas por sinal: PRISM recebe o esquemático ao
      carregar, criar projeto e processador não dormem mais um segundo cada, a
      árvore espera o evento `aurora:session-restore-settled` em vez de 3 s, o
      painel de atualização ouve o aviso do updater em vez de reler em 1,5 s, o
      terminal guarda o que chega durante a animação de limpar e repõe depois,
      e a remoção de arquivo da árvore espera a escrita no `.spf` e avisa se
      falhar, que era o único caso em que a tela mentia sobre o disco.

      O que ficou de fora, por decisão: `GIT_TERMINAL_PROMPT=0` não foi
      definido, porque o simple-git substitui o ambiente inteiro ao receber um
      `env` e o comentário do `remoteGit` registra que passar `process.env`
      já quebrou fetch e push uma vez; o prazo de ociosidade cobre o pedido de
      senha que ninguém vai digitar. E o Surfer continua sendo derrubado ao
      estourar o prazo, só que agora o prazo é honesto.

- [x] ~~**`glifo` é superfície de API que ninguém usa.**~~ Achado em 21/08/2026,
      fechado em 22/08. Caíram o campo e a reserva: `icone` é obrigatório nos
      dois catálogos, o painel só desenha arquivo, e o teste de ícones acusa
      componente sem marca antes de chegar à tela, que é onde a decisão de
      "um estado só" fica guardada.

- [ ] **O `bad allocation` do slang continua existindo.** Em 21/08/2026 entrou
      o disjuntor (`main/lsp/disjuntor.js`), que para de perguntar depois de
      três falhas seguidas e volta sozinho. Isso resolve a insistência e o log
      cheio, não a causa: o servidor segue sem responder ao completar código
      com o buffer no meio de uma edição. A causa é dele, em C++. Se voltar a
      incomodar, o caminho é reproduzir com um arquivo pequeno e abrir a
      questão no `hudson-trading/slang-server`, com o `.v` gerado em anexo.

- [ ] **A aurora da splash, o que sobrou.** A sessão de 26/08 foi aprovada pelo
      Chrysthofer olhando a tela em movimento, então o grosso saiu. Ficam aqui
      só as pontas, todas de acabamento.

      O que a sessão de 26/08 resolveu: o cintilar lateral, que levava 112 s
      para atravessar a tela numa splash que vive 9 s e portanto nunca tinha
      sido visto por ninguém; a respiração lenta de brilho por fita; as fitas
      subindo cerca de um décimo da altura; duas camadas novas de profundidade;
      máscara do céu e vinheta superior recalibradas para a aurora mais alta; e
      o custo medido de ponta a ponta (ver a nota em "Notas que evitam
      retrabalho").

      O item de CUSTO da lista antiga está respondido e não precisa da obra que
      ele propunha. A regressão de quadros por segundo que ele descrevia não
      reaparece: o intervalo entre quadros fica preso no vsync em 16,7 ms com
      três ou com cinco fitas, e o tempo até a IDE aparecer não mudou (8,9 a
      9,1 s contra 9,4 s). Borrar o buffer pequeno em vez da tela cheia, ou
      empilhar um canvas com `filter` de CSS, continuam sendo as saídas certas
      SE um dia o custo apertar, mas hoje não aperta e mexer nisso é otimizar
      no escuro.

      O que de fato falta:

      1. A borda de baixo ainda lê como horizonte em alguns quadros, que é a
         armadilha registrada no cabeçalho do módulo. Foi observada de novo em
         26/08 e não piorou nem melhorou. Ajudaria variar a LARGURA da fita ao
         longo dela, e não só a altura dos raios.
      2. Ideias não tentadas: perspectiva, com os raios convergindo para um
         ponto de fuga, que é o que dá a coroa quando a aurora passa pelo
         zênite; uma surge ocasional, o clarão que percorre a fita; e variação
         de temperatura de cor ao longo do comprimento.

      Onde mexer: os parâmetros ficam todos no vetor `FITAS`, um objeto por
      fita, e cada campo tem comentário dizendo o que move. Para comparar
      antes/depois é OBRIGATÓRIO fixar a semente, senão as fases sorteadas
      mudam o quadro e a comparação não vale nada; o procedimento está na nota
      de "Notas que evitam retrabalho".

## 5b. Painel de bibliotecas Python e instalação de componentes

Três pedidos que vieram juntos do uso, 26/08. Estão aqui como pendência, sem
implementação ainda.

- [x] ~~Refazer os selos do painel de Componentes.~~ Feito em 26/08/2026. Dos
      cinco selos sobraram dois, pela regra de que um selo só existe se disser o
      que o resto do cartão não diz: "Instalado" repetia o botão Remover, "Não
      instalado" repetia o botão Baixar E o tamanho escrito "download de 16 MB",
      e "Atualização disponível" repetia o botão Atualizar. Ficaram o do
      essencial, que explica por que aquele cartão não tem botão nenhum (e
      virou "Vem no instalador", em vez do canhoto "Sempre instalado"), e o de
      "Necessário para compilar", que é o único com urgência. O efeito é que
      quase todo cartão fica sem selo e o único que tem um salta aos olhos.
      A regra virou função pura `selosDe`, com teste próprio, porque os estados
      que ela separa quase nunca aparecem juntos numa máquina só: numa máquina
      com tudo instalado a interface fica igual esteja a regra certa ou errada,
      e foi essa a dificuldade ao tentar conferir na AURORA rodando.

- [x] ~~Refazer o painel de PyLibs.~~ Feito em 26/08/2026. O problema era
      densidade, e foi medido antes de mexer: 29 bibliotecas, cada cartão
      carregando duas linhas de prosa, a lista media 3244px e cabiam SEIS na
      tela. Agora a linha colapsada guarda o que decide (nome, versão, estado,
      tamanho) e a prosa desceu para a expansão que já existia, junto dos usos;
      a lista foi para 1807px e cabem catorze. O tamanho subiu da meta para a
      linha porque é o único número que decide sem abrir nada. Entrou também um
      filtro "Instaladas", com a contagem no próprio chip, que responde sem
      clique a pergunta mais frequente de uma lista de 29.

      O resumo continua no DOM quando colapsado, só escondido por CSS, porque é
      ele que o filtro por texto pesquisa: escondido, a busca acha; removido,
      não acharia.

      Fica em aberto, se um dia incomodar: a mesma fila de download em lote que
      o painel de Componentes ganhou hoje. Aqui ela é menos urgente, porque as
      bibliotecas são pequenas (dezenas de KB, não centenas de MB) e ninguém
      instala sete de uma vez.

## 6. Profissionalizar o repositório

- [x] ~~**`hero.png` do README.**~~ Feito em 11/08/2026 e já no README. Sai do
      aplicativo de verdade pelo [scripts/capture-media.js](scripts/capture-media.js),
      que monta um projeto descartável com a média móvel do manual, abre a
      AURORA nele, expande o terminal e captura 1600x1000. É script e não
      PrtScn porque a foto precisa ser refeita a cada mudança de interface, e
      uma tirada à mão carrega o desktop de quem tirou. Duas armadilhas ficaram
      registradas lá dentro: emular métrica por CDP não reflowa o layout, e a
      janela só aceita tamanho maior que o monitor depois de `unmaximize()`.
- [x] ~~**Os GIFs do README.**~~ Feitos em 23/08/2026, três dos quatro. O
      `split-editor.gif`, o `compile.gif` e o `prism.gif` estão no README, cada
      um ao lado do parágrafo que ilustra, e o `hero.png` foi refeito na
      interface de hoje. Os quatro somam 400 KB. Saem de
      `node scripts/capture-media.js tudo`, que abre a aplicação de verdade
      sobre um projeto que ele mesmo monta.

      O que custou, e que vale saber antes de mexer nisso de novo. A primeira
      corrida falhou inteira na tomada do PRISM porque o top level do projeto
      descartável instanciava o processador com portas inventadas, e a
      elaboração morre antes da síntese; a interface é o que o yanc gera, hoje
      `clk`, `rst`, `in`, `out`, `req_in` e `out_en`. O `compile.gif` saiu com
      5,6 MB e terminou com 64 KB, porque o dithering, que faz sentido em
      fotografia, gasta bytes espalhando ruído numa interface de cor chapada:
      medido em sessenta quadros reais, a paleta de 64 cores sem dithering deu
      um arquivo 28% menor E mais fiel (PSNR 42,3 contra 40,3 dB). E todos os
      GIFs corriam mais rápido que a realidade, porque eram montados na taxa
      PEDIDA e não na obtida: uma captura de tela da janela inteira custa mais
      que o intervalo pedido. O script agora mede a taxa, monta com ela,
      confere o arquivo pronto com o ffprobe e guarda os quadros quando o que
      saiu não bate com o que entrou.

      Falta o `waveform.gif`, que continua **não automatizável por aqui**:
      GTKWave e Surfer são janelas externas, fora do alcance do Playwright.
      Ou é gravação de tela sua, ou o Surfer embutido da seção 8 resolve junto.
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
- [x] ~~**Citações do relatório apontando para documentos que não existem.**~~
      Limpas em 23/08/2026. O apêndice citava `ROADMAP.md`, `RELEASE.md`,
      `docs/DESIGN.md` e `docs/CODE_SIGNING.md`, todos removidos na
      consolidação, e as mesmas pistas mortas estavam no gerador do relatório.
      Passaram a apontar para o que existe, com o `TODO.md` como único registro
      de pendências e decisões. Junto, uma afirmação que envelheceu: a seção de
      build dizia que instalador e updater não são assinados, o que deixou de
      ser verdade em 22/08.
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
- [ ] **Fase 3, paridade de linguagem, no repositório yanc.** Dono definido em
      22/08/2026: é o orientador quem mexe no yanc. As fases 1 e 2 são da
      AURORA e não dependem desta, tirando os limites já anotados no fim da
      seção. Detalhes do que falta, do lado do compilador:
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
- Mudou código do renderer? `npm run build:ts` NÃO basta: o renderer roda do
  `dist/`, e sem `npx vite build` a AURORA continua executando o bundle
  antigo. O `prestart` do `npm start` faz os dois, então quem sobe pelo
  atalho ou reabre a janela fica com o velho. Custou duas correções que
  pareciam não ter efeito em 23/08/2026.
- Referência hierárquica que ATRAVESSA escopo de `generate` elabora no Icarus
  e NÃO no Verilator 5.048, que responde "Known scopes under <escopo>: <no
  instances found>" mesmo com a condição verdadeira e o escopo existindo.
  Medido nos dois com design mínimo em 23/08/2026; é por isso que o monitor da
  pilha de instrução só sai sob Icarus. Vale para qualquer espelho futuro.
- PRISM, etiquetas de barramento: não esconder fio com retângulo pintado nem
  com `<mask>`. O canvas não é uma cor (grade de pontos e vinheta), e a máscara
  corta o brilho do realce com borda reta. O corte é na geometria do `<line>`
  (`_cutWiresUnderLabels`). Para conferir rendering sem abrir a AURORA: janela
  oculta do Electron com o SVG de `components/Temp/PRISM` e o CSS de `dist/`,
  `capturePage` e leitura de pixels; a sessão de 22/08 fez assim.
- Os portões antes de um commit não são quatro, são seis, e os dois esquecidos
  mordem no CI: além de `npx eslint . --max-warnings=0`, `npx vitest run`,
  `npx tsc --noEmit` e `node scripts/check-i18n.js`, o CI roda
  `node scripts/check-design-tokens.js` (catraca de cor e duração) e
  `node scripts/check-no-generated-js.js` (nenhum `.js` gerado de `.ts` pode
  estar versionado). Em 23/08/2026 os dois estavam vermelhos em `main` sem
  ninguém saber: cores de reserva entraram no `var()` de um recurso novo, e o
  `generate_blocks.js`, gerado do `.ts`, tinha sido commitado. O CI também
  roda `npm run deadcode`, `node scripts/gen-ai-tools-doc.js --check` e
  `node scripts/check-pinned-versions.js`, que são baratos e valem no fim.
- GIF de interface não se codifica como vídeo: dithering, que existe para
  disfarçar banda em fotografia, gasta bytes espalhando ruído sobre cor chapada
  e ainda afasta o pixel do original. Medido em 23/08/2026 com sessenta quadros
  reais: bayer deu 974 KB e PSNR 40,3 dB, e `palettegen=max_colors=64` com
  `paletteuse=dither=none` deu 705 KB e 42,3 dB. Menor e mais fiel ao mesmo
  tempo. E a taxa de montagem tem que ser a MEDIDA: capturar a janela inteira
  custa mais que o intervalo pedido, então montar na taxa pedida faz o filme
  correr mais rápido que a gravação.
- O projeto descartável do `capture-media` é Verilog de verdade e a elaboração
  o lê: a interface do processador NÃO é escolha do top level, é o que o yanc
  gera a partir do `.cmm` e do `.spf`, hoje `clk`, `rst`, `in`, `out`,
  `req_in` e `out_en`. Nome de porta inventado ali derruba a verificação antes
  de qualquer síntese, e o sintoma aparece longe, como uma janela do PRISM que
  não abre. Para conferir sem abrir a aplicação: `iverilog -y components/HDL
  -tnull -s top_mediamovel <topo.v> <processador gerado.v>`.
- Módulo `.ts` novo em `js/`: o `.js` que o `tsc` emite ao lado precisa entrar
  na lista do `.gitignore` NO MESMO commit. A lista é explícita, arquivo por
  arquivo, então um módulo novo não é coberto por padrão nenhum.
- O tooltip global do app (`js/ui/tooltip.js`) NÃO atravessa shadow DOM: um
  `data-tooltip` dentro de um componente Lit, como a tela de boas-vindas,
  nunca é descoberto pelo observador. Ou o balão é reimplementado em CSS
  dentro do próprio componente, como ficou na lista de recentes, ou o
  elemento vive fora do shadow. Em nó de DOM comum, como o marcador de
  tamanho do dump no terminal, o `data-tooltip` funciona sozinho.
- Botão novo numa linha da lista de recentes: os controles precisam estar
  dentro de UMA célula da grade. A lista é uma subgrade de três colunas, e um
  quarto filho joga o × para a linha seguinte em toda entrada riscada.
- Splash, custo de CPU medido em 26/08. O renderer da splash ocupa: 12% só com
  o céu, 29% com o céu mais as três fitas originais da aurora, 45% quando as
  fitas viraram cinco com passo 1 nas novas, e 36% depois de abrir o passo da
  camada de fundo para 4 e o da frente para 2. Isso importa porque a splash
  divide a CPU com a inicialização da IDE, mas o número que decide não é a
  ocupação e sim o tempo até a janela principal aparecer: com as cinco camadas
  ele ficou em 8,9 a 9,1 s, contra 9,4 s antes delas, ou seja dentro do ruído.
  Se um dia precisar cortar custo aqui, a ordem barata é: abrir o passo das
  fitas de menor contraste, depois baixar o ESCALA de 0,54 (mas não abaixo de
  meia tela, que é onde a borda de baixo passa a mostrar a grade).
  Para medir, o intervalo entre quadros NÃO serve: com vsync os dois casos dão
  16,7 ms e a diferença some. O que mede é ScriptDuration/TaskDuration do
  protocolo do Chrome, lidos duas vezes e subtraídos.
- Splash, medições da rodada de 26/08, para não refazer. O cintilar que corre
  de lado nas fitas da aurora andava 6,4 px/s e levava 112 SEGUNDOS para
  atravessar a tela, enquanto o splash vive por volta de 9 s: o movimento que o
  cabeçalho de `js/ui/aurora.js` chama de "o que mais identifica uma aurora"
  existia e não chegava aos olhos de ninguém. Os valores de `corrida` agora
  atravessam em uns 40 s. Também foi TESTADA E DESCARTADA a ideia de sortear
  várias direções de céu e ficar com a mais rica: em mil sorteios, a diferença
  entre o decil 10 e o decil 90 é de só 1,5x (626 contra 948 estrelas na metade
  de cima) e o pior caso tem 541, então não existe "céu vazio" a evitar. Quando
  uma abertura parece ter poucas estrelas, é a aurora cobrindo elas, porque o
  canvas da aurora fica ACIMA do das estrelas de propósito.
  Para comparar antes/depois é obrigatório fixar a semente: a aurora sorteia as
  fases das fitas e o céu sorteia a direção do olhar a cada abertura, então dois
  quadros de execuções diferentes nunca mostram a mesma coisa. O jeito que
  funcionou foi injetar um `Math.random` com semente num `<script>` clássico
  antes dos módulos, numa cópia temporária de `dist/html/splash.html` (tem de
  ser a construída: o catálogo de estrelas entra por `?inline`, que só o Vite
  resolve, e a fonte crua cai no campo aleatório de 130 pontos sem avisar).
- Dump de simulação em máquina travada: CONFIRMADO CORRIGIDO no LABEL em
  26/08/2026, com o relato de campo do Chrysthofer. O que segue é o registro do
  diagnóstico, que continua valendo como referência para sintomas parecidos.
  (laboratório, 25/08): o `.vcd`/`.fst`
  não era substituído e os alunos deletavam à mão. Medido no Windows real:
  sobrescrever um dump bloqueado faz o vvp falhar com exit 1 e um `FST Error`
  que se perde na saída; criar arquivo novo funciona porque criar e
  sobrescrever são operações diferentes para antivírus/política (por isso a
  árvore da AURORA cria normalmente e por isso deletar à mão resolvia). Também
  medido: GTKWave aberto no dump NÃO bloqueia a sobreposição (fopen compartilha
  escrita), mas bloqueia a deleção. Consequência de desenho: a blindagem testa
  ESCRITA (open 'r+' via `file:check-writable`), nunca deleção. Duas defesas em
  `js/compilation/dump_guard.js` + `compilation_module`: antes de simular,
  dump existente e não gravável aborta na hora nomeando o arquivo e a correção
  (EBUSY manda fechar o viewer; EPERM manda destravar/abrir exceção); depois de
  resolver o dump, mtime anterior ao início da corrida vira erro em vez de
  abrir onda velha. Cobre vvp, Verilator e cocotb.
- Relato #5 do canal (Vinicius, 24/08): "o consumo de RAM aumenta sem parar" ao
  abrir a tela do Git ou o painel de bibliotecas Python, em modo desenvolvedor.
  A investigacao de 24/08 NAO reproduziu o vazamento em nenhuma configuracao, e
  fechou as tres hipoteses que existiam. Nao refazer:
  1. O `AbortController` de vida longa de `main/ipc/git.js` (`abortos`,
     compartilhado por toda a sessao) NAO acumula ouvintes. O abort-plugin do
     simple-git registra no `spawn.before` e remove no `close`, e o par fecha:
     30 `git status` seguidos deixaram o sinal com zero ouvintes.
  2. As duas rondas periodicas (`git_panel.js`, de 8 s, e `git_decorations.js`,
     de 10 s) rodam, mas NAO fazem a memoria subir. Projeto git aberto e sujo,
     painel de Git aberto, painel de PyLibs aberto, 90 s por fase: heap
     +0,00 MB, nos do DOM e ouvintes constantes.
  3. A tempestade de eventos de arquivo, que era a hipotese do OneDrive, tambem
     NAO vaza. Desta vez o ensaio valeu: o projeto foi aberto pelo carregador
     completo (`projectManager.loadProject`, que e quem arma o vigia em
     `project_manager.js:281`) e a sonda contou os `directory-changed` que
     chegaram ao renderer. Com 8 eventos entregues, os nos subiram 152 e os
     ouvintes 96 UMA VEZ, que sao as 8 linhas novas da lista de alteracoes, e
     depois ficaram parados; a fase seguinte, com o disco quieto, nao devolveu
     nada nem continuou subindo. Se vazasse por evento, subiria a cada um.
  Detalhe que vale guardar: o debounce de 500 ms de `main/ipc/files.js` engole
  tempestade CONTINUA. Escrita a cada 200 ms durante 90 s gerou 442 escritas e
  UM unico evento. Para exercitar esse caminho e preciso espacar acima do
  debounce (800 ms deu 8 eventos em 112 escritas). Um ensaio com escrita rapida
  nao testa nada e parece um resultado limpo.
  Ferramenta: Playwright + CDP, `HeapProfiler.collectGarbage` seguido de
  `Performance.getMetrics`, medindo heap, nos, ouvintes e RSS do main a cada
  15 s; padrao de launch igual ao de `tests/e2e/smoke.test.js`. ~5 min por
  rodada. Sempre instrumentar a contagem de eventos: sem ela nao da para
  separar "nao vazou" de "o ensaio nao exercitou nada".
  Como o vazamento nao reproduz, o que sobra e a maquina do relator, nao o
  codigo: o clone dele estava no OneDrive e a instalacao tinha sido feita a
  mao. O `setup.bat` agora recusa pasta sincronizada, caminho de rede e avisa
  sobre caminho fundo. Se o relato voltar depois disso, pedir duas informacoes
  antes de investigar de novo: quanto tempo ate aparecer, e qual processo
  cresce no Gerenciador de Tarefas (principal, renderer ou GPU).
- PRISM, a grade dentro dos cartões de memória é símbolo da família (linhas por
  colunas = células armazenadas), gerada por `scripts/prism-skin-standard.js`
  com opacidade 0,16 a 0,22. Decidido em 22/08 manter; se incomodar, ajustar
  no gerador e regerar, nunca editar o SVG à mão.
