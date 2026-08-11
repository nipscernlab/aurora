# TODO

Backlog único do projeto, consolidado em 11/08/2026 a partir do PENDENCIAS.md e
do PLANO-2026-08-10.md (ambos absorvidos e removidos) e dos itens acionáveis de
CODE_SIGNING, LICENCIAMENTO, IMPLANTACAO_LABORATORIO, DESIGN e dos estudos, que
continuam em `docs/` como referência e runbook. A regra segue a mesma: entra
aqui o que não foi feito; ao concluir um item, risque ou apague, porque o git
guarda a história melhor do que uma lista de coisas prontas.

Estado verificado em 11/08/2026: `main` em `0de4109d`, CI verde, árvore limpa,
versão 6.3.2, PR #63 aberto propondo a 6.4.0, última release publicada é a
v6.2.0, instalador não assinado, updater completo no código (checagem 6 s após
o boot, re-checagem a cada 3 h, delta por blockmap, retry com backoff).
975 testes unitários, 20 E2E, 27 de toolchain.

O plano de deploy: instalar hoje num PC do LABEL, gerar a release e testar,
gerar uma segunda release e ver a atualização acontecer, e só então implantar
em todos os PCs. As seções 1 a 4 são esse plano em ordem; as demais vêm depois.

---

## 1. Release de teste e ensaio de atualização

O updater tem 12 testes de agendamento e o delta foi verificado no código, mas
ninguém nunca viu uma atualização acontecer. A promessa para o laboratório é
"instala uma vez e atualiza sem voltar presencialmente", e ela falharia em 30
máquinas ao mesmo tempo, com aula acontecendo. Este ensaio é o passo que a
frota não pode ser a primeira a fazer.

- [ ] Merge do PR #63. Isso cria a tag v6.4.0, dispara o `release.yml`, que
      constrói e publica `sapho-aurora-Setup-v6.4.0.exe` em `nipscernlab/sapho`
      e espelha as release notes para lá.
- [ ] Instalar a 6.4.0 na máquina limpa do LABEL e rodar o roteiro de
      verificação do IMPLANTACAO_LABORATORIO §8: a IDE abre; projeto de exemplo
      compila; simulação roda e a forma de onda abre (exercita a execução a
      partir de `components\Temp\`); Configurações > Sobre > Atualizações não
      reclama do servidor.
- [ ] Fazer uma alteração trivial, mergear o novo PR de release e publicar a
      6.4.1.
- [ ] Abrir o app na máquina do LABEL e observar o ciclo inteiro:
  - checagem silenciosa ~6 s após o boot; a janela de atualização aparece com o
    changelog preenchido (corpo vazio = o espelhamento de notes falhou);
  - o download é incremental: acompanhar os MB transferidos e comparar com os
    ~500 MB do instalador completo;
  - fechar o app aplica a atualização em silêncio, sem elevação; a próxima
    abertura mostra a 6.4.1 com o toast de confirmação;
  - Configurações > Sobre > Atualizações reflete o que aconteceu.
- [ ] Teste de resiliência no mesmo ensaio: derrubar a rede no meio do download
      e confirmar que a janela mostra a contagem regressiva e retoma sozinha.
- [ ] Se tudo passar, liberar a implantação na frota (seção 2).

Nota: essas releases saem sem assinatura, o que é esperado; a assinatura entra
depois (seção 3) e o primeiro release assinado será download completo para todo
mundo, porque a assinatura invalida os blocos do delta.

## 2. Implantação nos PCs do LABEL

O runbook completo, com os comandos prontos, é o
[IMPLANTACAO_LABORATORIO.md](docs/IMPLANTACAO_LABORATORIO.md). O que segue é a
lista do que precisa acontecer, e quase tudo é da TI do laboratório.

- [ ] Entregar o IMPLANTACAO_LABORATORIO.md à TI do LABEL.
- [ ] Decidir o modelo conforme o regime de perfil das máquinas: se o perfil é
      descartado no logoff (imagem congelada), a IDE entra na imagem base, não
      instalada por aluno. Isso precede a instalação.
- [ ] Exclusões do Windows Defender nas três pastas (`%LOCALAPPDATA%\Programs\SAPHO`,
      `%APPDATA%\SAPHO`, `%LOCALAPPDATA%\sapho-updater`); comandos no §4.1.
- [ ] Regras AppLocker/SRP para `%LOCALAPPDATA%\Programs\SAPHO\*` e para
      `...\SAPHO\components\*`, incluindo `components\Temp\` onde o Verilator
      compila executáveis na hora. A segunda regra é a que costuma ser
      esquecida, e sem ela a IDE abre mas falha ao compilar.
- [ ] Verificar que o Smart App Control (Windows 11) está desligado; ligado,
      a simulação por Verilator não roda e nenhuma assinatura resolve.
- [ ] Verificar que a política não remove o "Executar assim mesmo" do
      SmartScreen; sem ele o aviso vira bloqueio absoluto.
- [ ] Submeter o instalador ao Microsoft Security Intelligence portal
      (tarefa da TI, recorrente, uma por versão). É a ação de maior efeito
      contra o SmartScreen e não depende da assinatura.
- [ ] Conferir disco (~1,6 GB por perfil de usuário) e o proxy da rede da UFJF
      (o updater usa o proxy do sistema).
- [ ] Rodar o roteiro de verificação do §8 em cada máquina instalada.

## 3. Assinatura SignPath e licenciamento

A ordem é obrigatória e está analisada no
[LICENCIAMENTO.md](docs/LICENCIAMENTO.md); o runbook técnico, incluindo o YAML
pronto, é o [CODE_SIGNING.md](docs/CODE_SIGNING.md). O bloqueio de fundo: os
termos da SignPath exigem licença aprovada pela OSI, e a NIPS-CERN 1.1 não é;
a aprovação de 06/08 no painel deles vale para a licença antiga (MIT).

- [ ] Resposta da SignPath ao e-mail enviado em 10/08. Trava o resto da seção.
- [ ] Decidir as bases de licença com o orientador e, pela Lei de Inovação,
      provavelmente com o NIT da UFJF, antes de publicar qualquer mudança:
      AURORA em EUPL-1.2 (ou Apache-2.0); Verilog do SAPHO em CERN-OHL-S-2.0
      (ou W); yanc continua MIT; docs em CC-BY-4.0; NIPS-CERN 1.1 segue como
      base do laboratório para o que não entra no instalador. Verificar também
      obrigações da dupla afiliação com o CERN.
- [ ] Independente de tudo acima, e pode ser feito já: corrigir a contradição
      do yanc. O anexo A3 do `LICENSE` e a seção S1 do `LICENSE-SAPHO.md` dizem
      que a cadeia YANC está sob a NIPS-CERN 1.1; o repositório `nipscernlab/yanc`
      tem LICENSE MIT, e o MIT do v5.3 não retroage. No mesmo passo, corrigir o
      anexo A4 do `LICENSE`, que afirma que as versões publicadas são assinadas
      pela SignPath Foundation, o que hoje não é verdade.
- [ ] Aplicar as trocas decididas: um commit por repositório, reescrita dos
      anexos A2/A3 e do correspondente no LICENSE-SAPHO.md; transformar a
      cessão da seção 5 num CLA assinado por quem contribui; mover a
      "comunicação prévia" de condição de licença para pedido no README e no
      CONTRIBUTING; manter declaração explícita de marca (nome e logo SAPHO e
      AURORA não são concedidos pela licença de software).
- [ ] Painel da SignPath (só o usuário faz): resolver a política
      `release-signing` marcada INVALID; criar a Artifact Configuration para um
      único PE `sapho-aurora-Setup-v<versão>.exe`; decidir o modelo de
      aprovação antes de ligar o CI (um Approver por requisição, ou dispensa
      para build de origem verificada); criar pelo menos duas contas
      individuais (login compartilhado é proibido pelo ToS) com 2FA; confirmar
      org `SAPHO [OSS]` sem trial ativa; conferir o Trusted Build Systems
      (build roda no `aurora`, publica no `sapho`).
- [ ] Escrever a página pública de Code signing policy no site do projeto
      (papéis Autor/Revisor/Aprovador e privacidade). Pré-requisito do primeiro
      release assinado.
- [ ] Ligar a assinatura no `release.yml`, condicionada à existência do
      `SIGNPATH_API_TOKEN`, degradando para build não assinado se faltar. O
      YAML está no CODE_SIGNING.md e o `scripts/patch-latest-yml.js` já existe
      para re-hashear o `latest.yml` (sem isso toda atualização falha por
      checksum).
- [ ] Comunicar ao laboratório que o primeiro release assinado será download
      completo; depois dele volta o incremental.

## 4. Verificação ao vivo

Quatro áreas têm teste unitário e nenhuma verificação de ponta a ponta. Fazer
na máquina do ensaio, com o app de verdade.

- [ ] Aurora Intelligence: uma conversa completa por provedor configurado e
      uma chamada de ferramenta que toque a IDE (compilar, ler arquivo). A
      migração para a geração 7 do Vercel AI SDK (PR #52) nunca foi exercitada
      com provedor real; atenção a `createOpenAI`, `createAnthropic`,
      `createGoogleGenerativeAI`, `createDeepSeek` e `createGroq` em
      `main/ai/provider.js`.
- [ ] PyLibs: instalar e remover uma biblioteca de verdade no Python empacotado.
- [ ] Painel Git (Dagr): clone, commit, push e uma resolução de conflito.
- [ ] GTKWave e Surfer: abrir uma forma de onda e conferir o desenho na tela
      (limite do método automatizado). O Surfer subiu cinco tags em 10/08 e
      ganhou um painel lateral retrátil com atalho; olhar em particular.
- [ ] Anel de foco no Monaco: a sonda anterior varreu o foco sem arquivo aberto
      no editor. Abrir um `.v` de verdade e medir; o corpo do terminal e o chat
      já foram corrigidos.

## 5. Melhorias na AURORA

Pós-release, com a regra de sempre: medir antes de mexer.

- [ ] P6, o que sobrou: as transições de largura da árvore e do painel de IA ao
      abrir e fechar pelo botão. O custo não é mensurável pelo harness (janela
      invisível pausa animação e o rAF não dispara); medir com o app aberto e
      arquivos no editor. Só com a medida na mão decidir a troca por
      `transform`, que exige invólucro de largura fixa e muda o comportamento
      do editor no colapso. O arranque já foi corrigido em 10/08 e o
      `.ai-usage-fill` fica como está, por decisão registrada.
- [ ] God files: `ai_assistant_manager.js` (3533 linhas) e
      `compilation_module.js` (3125) são classes únicas sem função de módulo
      para extrair. O caminho decidido é o inverso: primeiro cobrir por fora
      com E2E do painel de IA e do fluxo de compilação, depois dividir por
      dentro. Trabalho do SAPHO seguinte. O `main/ai/tools.js` fica: é vetor de
      dados e dividi-lo mudaria a ordem das ferramentas para o modelo.
- [ ] CRUD da árvore de arquivos, lacunas do ESTUDO_COMPLETO §16.3 (o drag &
      drop já saiu em 08/08): multi-select com Ctrl/Shift, undo com Ctrl+Z,
      auto-refresh por watcher na visão Folders, preservar cursor e scroll no
      rename, awareness do `.spf`.
- [ ] Restos de design: 96 valores de espaçamento fora da escala (ou a escala
      ganha os degraus 10/14/18 px, ou ficam); 74 `!important`, dos quais ~30
      contra o CSS do Monaco e só saem com Shadow DOM; consolidar as paletas
      divergentes de `splash.html` e `update-notification.html`; avaliar o lint
      de design no CI proposto no DESIGN §11; decidir a marca entre SAPHO,
      AURORA e Dagr.
- [ ] jQuery preso na 3.x pelo digitaljs: subir os dois juntos quando o
      digitaljs publicar suporte à 4, e abrir o modo Simular num design real.

## 6. Repo profissional

- [ ] Mídia real do README: `hero.png` e os quatro GIFs da shot list de
      [docs/media/](docs/media/README.md). Capturar do app de verdade, sem
      fabricar arte.
- [ ] Atualizar o DESIGN.md onde ele ficou para trás do código: §8 diz que não
      há webfonts locais (há, em `assets/fonts/`) e manda remover FontAwesome
      (já não existe); §9 diz que a command palette não existe (existe); §11
      trata o Design Lab como a construir (existe).
- [ ] Podar o ESTUDO_COMPLETO_AURORA.md: remover os logs de sessão §14.50 a
      §14.53 e os itens já feitos do §18.5, corrigir as três referências à §17
      que não existe mais, e alinhar os números divergentes de contagem.
- [ ] Corrigir os números de linhas do ESTUDO_CODIGO_AURORA.md (defasagem
      pequena, o repo andou desde 07/08).
- [ ] CITATION.cff: `date-released` está em 2026-06-16; atualizar no release.
- [ ] Conferir o `package-name: "aurora-ide"` do release-please-config contra o
      `name: "sapho"` do package.json; alinhar ou registrar por que divergem.
- [ ] `docs/referencia-tecnica-sapho/_fonte/apendices/referencias.tex` cita
      ROADMAP.md e RELEASE.md, que não existem; limpar na próxima edição do
      relatório.

## 7. Depois do laboratório

Escopo do SAPHO seguinte; prioridade muda conforme a necessidade da disciplina.

- [ ] C++ como segunda linguagem de processador. A especificação completa, com
      32 itens em três fases e arquivo:linha, é o
      [ESTUDO_CPP_PROCESSADORES.md](docs/ESTUDO_CPP_PROCESSADORES.md). Antes da
      fase 1, decidir o rename do campo `cmmFile` do `.spf` para `sourceFile`,
      porque depois o custo cresce com a base de projetos.
- [ ] Processo de IA persistente por conversa, para matar o arranque frio da
      CLI a cada turno.
- [ ] Surfer embutido como padrão. Bloqueado: o upstream não publica bundle
      WASM baixável.
- [ ] Terminar a migração da casca para Lit (abas, árvore, terminal, barra de
      estado).
- [ ] Multiplataforma (Linux/macOS). Bloqueado pela toolchain, que é só
      Windows.

## Notas que evitam retrabalho

- O binário do Verible da tag `v0.0-4135-g7807ee1a` se declara
  `v0.0-4131-g93141f42` no `--version`. Não é instalação velha; é o carimbo do
  próprio Verible atrasado. Não reinvestigar.
- Testes de geometria E2E: a janela pede 1280 px e o Windows corta para o que
  couber no monitor. Medir a janela antes de suspeitar do código.
- Máquina nova de desenvolvimento: `git pull`, `npm ci`,
  `node scripts/verify-components.js --yes`. Conferência sem download:
  `node scripts/check-component-drift.js`, que deve dizer "7 em dia".
- O barramento de eventos da AuroraAPI não tem assinante; o comentário que diz
  que a Aurora Intelligence o consome está impreciso (não existe ferramenta de
  assinar evento no manifesto). Funciona, custa sete listeners, sem urgência.
- A família do Vercel AI SDK (`ai` + `@ai-sdk/*`) nunca sobe em pedaços; o
  grupo `ai-sdk` do dependabot já garante isso.
- O `scripts/patch-latest-yml.js` está órfão de propósito: é a tubulação
  pré-posicionada do fluxo de assinatura da seção 3.
