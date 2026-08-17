# Changelog

All notable changes to this project are documented here. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project loosely follows [Semantic Versioning](https://semver.org).

## [6.4.3](https://github.com/nipscernlab/aurora/compare/v6.4.2...v6.4.3) (2026-08-16)


### Bug Fixes

* **docs:** manual online muda para nipscern.com/library/sapho ([1534f43](https://github.com/nipscernlab/aurora/commit/1534f433ea0c334392514fef5be4facf048c6c50))


### Documentation

* **todo:** a atualizacao precisa do caminho do updater liberado, e o instalador nao pode rodar como admin ([52a11ac](https://github.com/nipscernlab/aurora/commit/52a11ac3c4ebb51f915abd6cb77db19837338089))
* **todo:** o disco por perfil era 1,6 GB no papel e e 2,3 GB medido ([df8a3ca](https://github.com/nipscernlab/aurora/commit/df8a3ca4a79ff9322449662fd1770a48863531ef))

## [6.4.2](https://github.com/nipscernlab/aurora/compare/v6.4.1...v6.4.2) (2026-08-14)


### Bug Fixes

* **update:** publica a limpeza da janela de atualizacao ([f9b902d](https://github.com/nipscernlab/aurora/commit/f9b902d161f4937edf73e6ea442a587ed35e756c))

## [6.4.1](https://github.com/nipscernlab/aurora/compare/v6.4.0...v6.4.1) (2026-08-14)


### Bug Fixes

* **lifecycle:** garante que fechar a AURORA mate o processo, e varre orfaos ao abrir ([401ce9b](https://github.com/nipscernlab/aurora/commit/401ce9b550bd658914271b42020c21461670a599))
* **release:** a publicacao sai das maos do electron-builder e vira um passo so ([ea2be9b](https://github.com/nipscernlab/aurora/commit/ea2be9b4a3a6d7457427714caeb9374d9e739728))
* **release:** a sentinela procurava um surfer.exe que foi renomeado ha tempo ([bd45142](https://github.com/nipscernlab/aurora/commit/bd4514230c8ec1a7e51d1ce81ef0d9b0c14c4766))
* **release:** o espelhamento das notas nunca rodou, e ninguem tinha visto ([45b1d64](https://github.com/nipscernlab/aurora/commit/45b1d64632947d61156b5e3951eb22837bf2edd1))
* **release:** o portao de integridade lia bytes e acusava um feed que estava certo ([690d5d7](https://github.com/nipscernlab/aurora/commit/690d5d7ee087f2abf092336cf1ced6cb4bce1b63))
* **updates:** "verificar agora" responde na interface, e nao num dialog modal ([6dc3b4e](https://github.com/nipscernlab/aurora/commit/6dc3b4e559f45e3dc7af5724cb35b072fe3bcaf3))


### Refactor

* remove as nove funcoes que ninguem chamava ([22421e3](https://github.com/nipscernlab/aurora/commit/22421e31ae07392fcb04b01bfca1c4f9f5bae561))


### Documentation

* **licenca:** o YANC nao e software de terceiros, e obra do laboratorio ([41845fe](https://github.com/nipscernlab/aurora/commit/41845fe7beee3b59b934723d7e84c2e51b684e4d))
* **todo:** risca a release publicada e registra codigo morto e estilos ([fbd768a](https://github.com/nipscernlab/aurora/commit/fbd768a549505fe7ca1e0c090d1e5cbec8eaf55b))
* **todo:** risca as paletas e a varredura de codigo morto, com o que sobrou de cada uma ([e4e4368](https://github.com/nipscernlab/aurora/commit/e4e43683ed5bb2c62cf7e0acc7096b90cbca468b))


### Build

* **deps:** bump @anthropic-ai/claude-code from 2.1.222 to 2.1.226 ([#69](https://github.com/nipscernlab/aurora/issues/69)) ([1a863ca](https://github.com/nipscernlab/aurora/commit/1a863ca436d35dec18c5465e9e6060424f78b2a1))
* **deps:** bump @openai/codex from 0.146.0 to 0.147.0 ([#71](https://github.com/nipscernlab/aurora/issues/71)) ([58523e0](https://github.com/nipscernlab/aurora/commit/58523e05488a4a208867c6f8bcfbee5f34657e5f))
* **deps:** bump actions/upload-artifact from 4 to 7 ([#76](https://github.com/nipscernlab/aurora/issues/76)) ([96473bd](https://github.com/nipscernlab/aurora/commit/96473bdb6adf2d2faff17dcf3b13bda05853d8ca))
* **deps:** bump katex from 0.18.2 to 0.18.3 ([#74](https://github.com/nipscernlab/aurora/issues/74)) ([afa632d](https://github.com/nipscernlab/aurora/commit/afa632db2da78c305902b6bfeeed02742ad3b872))
* **deps:** bump web-tree-sitter from 0.26.11 to 0.26.12 ([#75](https://github.com/nipscernlab/aurora/issues/75)) ([18f9781](https://github.com/nipscernlab/aurora/commit/18f97816ff947060201d4debac721364720a2683))

## [6.4.0](https://github.com/nipscernlab/aurora/compare/v6.3.2...v6.4.0) (2026-08-11)


### Features

* **a11y:** focus-trap + return-focus no aurora-modal, aria-live no aurora-toast ([d24134d](https://github.com/nipscernlab/aurora/commit/d24134df3019601b0ec2aee090e6a68a2acc2c82))
* **about:** disclosure de software de terceiros no painel About (item 25) ([3d4ac32](https://github.com/nipscernlab/aurora/commit/3d4ac32038d59a56908101d0d76f1732945ea1e5))
* **ai:** baixa Claude Code/Codex sob demanda (B12) — instalador ~457MB menor ([44f2685](https://github.com/nipscernlab/aurora/commit/44f26856e51cc3edddc8c2840d48702329a199f5))
* **ai:** brilho do painel de IA em onda — cortinas que cruzam, pulso bem suave ([4663af7](https://github.com/nipscernlab/aurora/commit/4663af72df91860cadf934c55686cd22c24387ad))
* **ai:** click an attached chat image to view it full-size (lightbox) ([09fd100](https://github.com/nipscernlab/aurora/commit/09fd10016fd873f18bee6c3c9d67d2c32ddc4eda))
* **ai:** composer attachments — UI + payload (images & files), part 1/2 ([8d7e27b](https://github.com/nipscernlab/aurora/commit/8d7e27ba8db472e376c7c6ba0cad167b62364c6f))
* **ai:** consume composer attachments in all 3 transports (images & files), part 2/2 ([494df92](https://github.com/nipscernlab/aurora/commit/494df92d914f201521ff5df336568e5c0ad6fe8f))
* **ai:** enriquece system prompt (diretivas SAPHO + tools novas) ([026c8f0](https://github.com/nipscernlab/aurora/commit/026c8f09ec63d7452b4dbdf3a61722331b9ab7ba))
* **ai:** fechar projeto e criar layout do Surfer viram ferramentas ([41d8b88](https://github.com/nipscernlab/aurora/commit/41d8b88b1facbf50a7a3af2a448fce9f77ce447c))
* **ai:** fixes de render do chat (ordem/LaTeX) + barra de uso do Claude ([b2a9b6b](https://github.com/nipscernlab/aurora/commit/b2a9b6b1d46ae49449fadd1ebc20fcc8e7aa0511))
* **ai:** G1 — APIs de git completas para a IA (namespace git + 14 tools) ([e5c9a24](https://github.com/nipscernlab/aurora/commit/e5c9a24407b04f7a50e921d5138ed2b98fa80078))
* **ai:** governança de modelos (G6) — robustez de id + tokens por conversa ([281aa4b](https://github.com/nipscernlab/aurora/commit/281aa4b414356b92427b9a0daeb5c6c6b9c6ea92))
* **ai:** injecao mid-turn — follow-up entra na sessao viva ([bdea140](https://github.com/nipscernlab/aurora/commit/bdea140491188ea0b76a148d7e039912a5fcdcfe))
* **ai:** memoria de projeto (remember/forget/list_memories) ([abfd0ce](https://github.com/nipscernlab/aurora/commit/abfd0ce48965ab11c8f233ded8ba0445fb8353c2))
* **ai:** ponte Claude Code migrada para o Claude Agent SDK (com fallback) ([1111ede](https://github.com/nipscernlab/aurora/commit/1111ede49e2818f2af41c71ae428745063bb4115))
* **ai:** ponte Codex migrada para o @openai/codex-sdk (com fallback) ([28bec3e](https://github.com/nipscernlab/aurora/commit/28bec3e511322651a137150b19ecb475130ded78))
* **ai:** registro permanente da pergunta + visual do multiSelect ([ad1388a](https://github.com/nipscernlab/aurora/commit/ad1388a8ee9c4098b9534e5f35644ccda0ec0fb5))
* **ai:** retry/backoff transitório + tabela única de timeouts (§18.5 itens 4-5) ([c8cd3fc](https://github.com/nipscernlab/aurora/commit/c8cd3fcfacc100c7e0e344195dd0469a1beec313))
* **ai:** tools run_in_terminal e open_surfer ([710857b](https://github.com/nipscernlab/aurora/commit/710857bd294671527cd59790f33fdccc8afc0fd9))
* **api:** createProcessor recusa duplicata pela file tree (pasta no disco), revive ref morta do .spf ([7f655f5](https://github.com/nipscernlab/aurora/commit/7f655f54add91eb12a8b7ae6107e83fd32f5740d))
* **api:** get/setSurferMultiWindow nas AI tools (toggle de varias janelas do Surfer) ([461129b](https://github.com/nipscernlab/aurora/commit/461129be4035087098b52d5b19bc2c53296b7d03))
* aurora-panel shell + Surfer/GTKWave procType var-tag + git badges right-align ([b2eed4e](https://github.com/nipscernlab/aurora/commit/b2eed4e255f3b41e0e5e7d341445b7fb904745b4))
* **aurora-tabs:** passo 2 — tablist ARIA acessivel (sem rewrite data-driven) ([3980617](https://github.com/nipscernlab/aurora/commit/398061792f80849429a5b1ce07c531f92239552b))
* **aurora:** cortinas de aurora em perspectiva 3D no welcome (estilo Gemini) ([0bbec6c](https://github.com/nipscernlab/aurora/commit/0bbec6cfa5d40c1e78aa89b4ae0829476d3eb85c))
* **bootstrap:** doctor de componentes com restauro e deteccao de bump ([6ee9ede](https://github.com/nipscernlab/aurora/commit/6ee9ede0d7e84ab9dfb5280819e7f909e7bbfbad))
* **dev:** jank overlay — p99 rAF, FPS, jank rate, longtask, TTI HUD (§4.4/G7) ([d4f7735](https://github.com/nipscernlab/aurora/commit/d4f7735c8cc5da506d866a749d2c3c9108c858ab))
* **docs:** manual do SAPHO online e offline no painel About ([#36](https://github.com/nipscernlab/aurora/issues/36)) ([b31b7ed](https://github.com/nipscernlab/aurora/commit/b31b7ed0c3293cc10f8e0f4c9ca91263f704f788))
* **docs:** o manual abre no navegador ou numa janela nossa, a escolha do usuario ([13b3f33](https://github.com/nipscernlab/aurora/commit/13b3f338a80159014b6ba607b550fa2e330354d9))
* **editor:** &lt;aurora-editor&gt; — shell semantico do painel do editor ([09e3cac](https://github.com/nipscernlab/aurora/commit/09e3cacfa244e1e9f8cb46493f8e4f555e238574))
* **editor:** formatação C/C++/CMM no Shift+Alt+F via clang-format ([62e31e6](https://github.com/nipscernlab/aurora/commit/62e31e6d595f2c7eb1e5f1434a799b3af5e0929a))
* **editor:** O7 — highlight preciso via tree-sitter (Verilog/SV/C/C++) ([474a0bb](https://github.com/nipscernlab/aurora/commit/474a0bb69166f6143a0ffa44ac63e741df19c1dc))
* **editor:** preview markdown/HTML em split (botão lupa) ([0f8c49d](https://github.com/nipscernlab/aurora/commit/0f8c49d5fbd43e58359a78beac5e600b04b3fbcd))
* **editor:** rolagem casada entre o codigo e o preview renderizado ([c552b11](https://github.com/nipscernlab/aurora/commit/c552b11c33b37708f9047e7a28a64a240d27ca6f))
* **editor:** syntax highlight de MATLAB/Octave (.m) ([3f6fe1f](https://github.com/nipscernlab/aurora/commit/3f6fe1f6e4ba0abe7e402c841115355a0bd69455))
* **editor:** the focused editor's tab always activates (incl. splits) ([e568161](https://github.com/nipscernlab/aurora/commit/e56816155acf0d243c69601058dc4b633e3cd546))
* **editor:** varinha de formatar ao lado do split, e a IA usa o mesmo caminho ([e389b83](https://github.com/nipscernlab/aurora/commit/e389b832e36873578e86b58f5201b2ca0d097d73))
* **file-tree:** CRUD completo estilo VS Code na view Folders + open terminal here ([711dfd4](https://github.com/nipscernlab/aurora/commit/711dfd4a953dee9374b28e662135e2a4c55f9764))
* **file-tree:** rework Folders view with library icons, gitignore muting and .inv ([3d173de](https://github.com/nipscernlab/aurora/commit/3d173dee4b00412c017dee7b8eb43bd217b9c300))
* **git+i18n:** i18n EN/PT (painel IA + painel Git) e nova experiencia de clone (workflow 4 agentes) ([9d75dcc](https://github.com/nipscernlab/aurora/commit/9d75dcc7187fe9db6dc03b55edc1027ebe2e7545))
* **git:** ativar login OAuth (Device Flow) — Client ID do OAuth App "sapho" ([082ea72](https://github.com/nipscernlab/aurora/commit/082ea72e1e86da2a66da087c5f88c82b415f3eb1))
* **git:** backend de source-control embutido (simple-git) + conexao de conta GitHub ([3c109a3](https://github.com/nipscernlab/aurora/commit/3c109a3cabd8517c129dbfc6d3e6abc6e4d0fca3))
* **git:** branches estilo GitHub Desktop — trocar, criar e merge (1/3) ([3188f58](https://github.com/nipscernlab/aurora/commit/3188f5877f235f4d6e62cfa6aa453de6b22ffb6d))
* **git:** changes com checkbox (marca staged) + linhas +/- por arquivo + commit exige titulo ([2d4dd19](https://github.com/nipscernlab/aurora/commit/2d4dd19fd2ef029b8c7c93ba2301241a754fb4ee))
* **git:** commit no diff de history + feedback no clique, amend pro, descricao auto-grow, push so com commit ([38b4820](https://github.com/nipscernlab/aurora/commit/38b48204f24ec533775432b2d4736c3a9b7584d4))
* **git:** Dagr usa a fonte Norse correta (download no bootstrap) + header redesenhado ([bc9d5cd](https://github.com/nipscernlab/aurora/commit/bc9d5cdd8592556eb026739b865a832ae022a593))
* **git:** Dagr, nome e runa Dagaz para o Source Control (G2) ([1b2c3c3](https://github.com/nipscernlab/aurora/commit/1b2c3c3043c5807b427df80c2d6eca33c29394fc))
* **git:** destacar repos seus vs de organizacao + open-in-SAPHO verificado + limpar tudo ao desconectar ([7b32acb](https://github.com/nipscernlab/aurora/commit/7b32acb0b27935eb423af812733afa054b1e4251))
* **git:** feedback ao vivo no painel + corrige barra vazia e foto de perfil ([363ef4e](https://github.com/nipscernlab/aurora/commit/363ef4e9473213b49df042fdb6b4780ef9607f8a))
* **git:** gerenciador de projetos clonados + menu de contexto + .spf tolerante ([a2ddcd7](https://github.com/nipscernlab/aurora/commit/a2ddcd716bcbbded0858c1545e61bb1a6e88abe6))
* **git:** guia "i" do token — passo-a-passo + tabela de permissoes por recurso (PT/EN) ([63b3072](https://github.com/nipscernlab/aurora/commit/63b30725373b7b008e97794122112d5fe60181ed))
* **git:** indicador do GitHub na status bar (icone -&gt; avatar ao logar) ([1cf5b8a](https://github.com/nipscernlab/aurora/commit/1cf5b8a1f661cf9d03ed9fbff0e9061a54a7e0c7))
* **git:** login OAuth (Device Flow) + criar repo com arquivos + aviso ao abrir projeto ([d849d66](https://github.com/nipscernlab/aurora/commit/d849d66ebdffe902480875eecb0c9e20986fb243))
* **git:** marca d'agua "Dagr" (rune + Norse) no fundo do painel Dagr ([a268edc](https://github.com/nipscernlab/aurora/commit/a268edc9d753d88548bf545453d359bdb122eb7a))
* **git:** menu de branches sem corte + ver historico de clone sem .spf (browse read-only) ([1a8c3ad](https://github.com/nipscernlab/aurora/commit/1a8c3adc13dc8864b1e25932ab2a8ad1fbccd06e))
* **git:** nome do repo, criar repo se nao houver, historico; brilho visivel + badge limpo ([b79a7bc](https://github.com/nipscernlab/aurora/commit/b79a7bc805a5bf102cd95bd13a0b0a08f3320500))
* **git:** overhaul visual estilo GitHub Desktop + fade do progresso + lembrar pasta de clone ([90ba38e](https://github.com/nipscernlab/aurora/commit/90ba38e6a97e140e66313962124733df76809c6c))
* **git:** painel completo estilo GitHub Desktop (abas, commit rico, undo/amend, clone) + badge ([8c97a85](https://github.com/nipscernlab/aurora/commit/8c97a85bbd08a4bc816c9514eca4babdd4ea6e07))
* **git:** painel de source-control embutido (UI) — conectar conta + gerenciar projeto ([89ce653](https://github.com/nipscernlab/aurora/commit/89ce653b2b1a3057aed90051719fc5a742e7df56))
* **git:** refaz o painel + corrige push/pull/diff/avatar; brilho vira raio arcado ([7132b8c](https://github.com/nipscernlab/aurora/commit/7132b8cbbc791c9ffcefb4f1e3c7490272caa9cc))
* **git:** repos de organizacoes na lista de clone + barra de progresso do clone ([5b3b52d](https://github.com/nipscernlab/aurora/commit/5b3b52d1d33f1b90faaba006e05a5da677b20ca4))
* **git:** stage otimista (sem recarregar tudo) + selecao por shift + changes ao vivo ([434f4b7](https://github.com/nipscernlab/aurora/commit/434f4b742751098a1b9eecc43cfa6547b41e5c96))
* **git:** stash — trocar de branch com alteracoes nao commitadas + restaurar/descartar ([32975e9](https://github.com/nipscernlab/aurora/commit/32975e963cc09ac59236c14a8d6a3e6afcd840ff))
* **i18n:** G4 — auditoria de i18n (script + guard de CI) + 5 chaves; command-palette ja pronto ([a9176d7](https://github.com/nipscernlab/aurora/commit/a9176d7d0a55a68d517329e7aa2def92984d233d))
* **lsp:** O11 — slang-server (análise semântica de SystemVerilog + autocompletar) ([96f6507](https://github.com/nipscernlab/aurora/commit/96f65076cf5c267a52953dd7b6099b5289f7620d))
* **lsp:** O2 — Verible language server (diagnostics, format, outline, hover, def/refs) ([d445088](https://github.com/nipscernlab/aurora/commit/d445088a65408d740a83874c66158b16e7a9ad62))
* **prism:** área de trabalho da simulação — rótulos limpos, fit/zoom/pan, contraste ([723f528](https://github.com/nipscernlab/aurora/commit/723f528772adac32124ba692fe7f1191316d2f60))
* **prism:** fundo uniforme + dígito 0/1 ao vivo em cada caixinha de I/O ([dd05884](https://github.com/nipscernlab/aurora/commit/dd05884e5ec4a949a2da26aab3264f1405d3096e))
* **prism:** mouse back/forward buttons walk the module click history ([9384a1a](https://github.com/nipscernlab/aurora/commit/9384a1a6a640ed4d0fdb88b688bc23feaa729df7))
* **prism:** simulação DigitalJS interativa no PRISM (O9, modo "Simular") ([dcaa6aa](https://github.com/nipscernlab/aurora/commit/dcaa6aa7a47b1ea426d2255c86d38ef2f109c616))
* **pylibs:** bibliotecas valem para qualquer .py, com isolamento por .pth ([edb1c50](https://github.com/nipscernlab/aurora/commit/edb1c50265f56642a1bd1d378b6e16e02b40bad9))
* **pylibs:** doctor de integridade, 29 bibliotecas, logos reais e toolbar em duas linhas ([9f327a2](https://github.com/nipscernlab/aurora/commit/9f327a20443a707b39cdfefbf88751592d5fbde8))
* **pylibs:** lista vem do repo publico aurora-pylibs, com copia local de reserva ([bb6c47b](https://github.com/nipscernlab/aurora/commit/bb6c47b92611179b6434d7de9570bfa7e78c74a5))
* **pylibs:** painel de bibliotecas Python com instalar, remover e reparar ([9081148](https://github.com/nipscernlab/aurora/commit/908114833673a2be4002f9b40cf27ca2f01c0fbe))
* **rename:** rename de projeto da IA vira job com progresso + verdito final ([75afc52](https://github.com/nipscernlab/aurora/commit/75afc527f393344d99d3228bb676c3fccbacf029))
* **search:** "Find in files" — busca em todo o projeto (item 32) ([f42f8ac](https://github.com/nipscernlab/aurora/commit/f42f8acddfb0d491a1f6c63e424f6fd41abe8f2c))
* **search:** persiste os toggles do find-in-files (O4) + fecha o tier facil ([0d634d0](https://github.com/nipscernlab/aurora/commit/0d634d088cf5790984a93912cee39ec2f97eac3e))
* **security:** add a Content-Security-Policy + sandbox every window (§13.G) ([13ac024](https://github.com/nipscernlab/aurora/commit/13ac02430681d085d14e2ccb819e10c9b538fa34))
* **shell:** &lt;aurora-modal&gt; base chrome (Design Lab) + defer the toolbars in §13 ([9d9f3b3](https://github.com/nipscernlab/aurora/commit/9d9f3b3de85471efc8c7bcf62a67dfe5feb581c4))
* **shell:** convert Processor Hub + Wave Config to &lt;aurora-modal&gt; (3 of 4 done) ([50f7d3d](https://github.com/nipscernlab/aurora/commit/50f7d3dde5deaa97c46ca25fc578bed68d4562a1))
* **shell:** convert the Settings modal to &lt;aurora-modal&gt; — all 4 modals done ([e796131](https://github.com/nipscernlab/aurora/commit/e7961318270b9011ee928c2e6b7783b333a9e566))
* **shell:** Lit foundation + Design Lab + first component &lt;aurora-statusbar&gt; (Lit shell Fase B) ([7e43aca](https://github.com/nipscernlab/aurora/commit/7e43aca7fedfed8466a7afacf75c46bfa3c19f26))
* **shell:** migrate command palette to &lt;aurora-command-palette&gt; (3rd live component) ([96d5e3c](https://github.com/nipscernlab/aurora/commit/96d5e3c4a9b9115a56efc780e8688fef8939f7a1))
* **shell:** migrate notifications to &lt;aurora-toast&gt; — first live Lit component (Fase C) ([2c001ce](https://github.com/nipscernlab/aurora/commit/2c001cece82d82c8f90c8eee3db16eb7ae0d3d82))
* **shell:** migrate the tooltip to &lt;aurora-tooltip&gt; (Lit shell, 2nd live component) ([a9e5111](https://github.com/nipscernlab/aurora/commit/a9e51112c76c7fb6cf1ba4e178b741f3822675e7))
* **shell:** migrate welcome screen to &lt;aurora-welcome&gt; (4th live component) ([2f3e1c4](https://github.com/nipscernlab/aurora/commit/2f3e1c46a0500a95b5bcb9dcba8d0669ad57651d))
* **shell:** wire &lt;aurora-modal&gt; as a drop-in + convert the New Project modal ([156844a](https://github.com/nipscernlab/aurora/commit/156844a09b078a12ccc0fc9157341d1a08160c36))
* **statusbar:** liga a &lt;aurora-statusbar&gt; ao vivo (thin shell) — primeiro do tier 2 ([d7d1702](https://github.com/nipscernlab/aurora/commit/d7d1702852f16fbb06e496a8f8053fa027112930))
* **surfer:** AURORA usa o fork NIPSCERN surfer-aurora.exe no lugar do upstream ([a4b39a7](https://github.com/nipscernlab/aurora/commit/a4b39a7bedee54536faae99bea2af2322d5254dd))
* **surfer:** liga o download do binario do fork (v0.7.0-nips.1 publicado) ([0aca6a7](https://github.com/nipscernlab/aurora/commit/0aca6a77d86bd1b83b606454929ceb97ec6e721b))
* **surfer:** sinais de 1 bit como onda quadrada (format 'Bit') ([19bbc02](https://github.com/nipscernlab/aurora/commit/19bbc0262505e987ee62938573abb0b1ed8dd5fe))
* **tabs:** &lt;aurora-tabs&gt; — shell semântico do tab strip (migração Lit step 1) ([fb0e943](https://github.com/nipscernlab/aurora/commit/fb0e9437804368b6c36d540642adba80f296d22f))
* **terminal:** &lt;aurora-terminal&gt; — shell semântico do painel de terminal (Lit step 1) ([67306c8](https://github.com/nipscernlab/aurora/commit/67306c837f150f90f8fa33ff143ab857f98aa3f7))
* **terminal:** as abas que nao cabem vao para uma lista, em vez de encavalar ([af9c56a](https://github.com/nipscernlab/aurora/commit/af9c56a3a53d1fd4fbbf35e18e694eb01579683a))
* **terminal:** auto-scroll suave que sempre chega no fim e segue o stream ([bb5f138](https://github.com/nipscernlab/aurora/commit/bb5f1387f891761d3d15cd974ff8922c3f4fee1a))
* **terminal:** prompt tematizado (aurora) no TCMD ([156febe](https://github.com/nipscernlab/aurora/commit/156febe8bf278c1372f3f2ffb2f45fcd7f355cc0))
* **terminal:** shell interativo embutido (TCMD) ao lado do THTEST ([0512618](https://github.com/nipscernlab/aurora/commit/05126189705fa991633587c0d315ab927b957266))
* **terminal:** terminal estreito empilha as abas numa coluna a direita ([629d98b](https://github.com/nipscernlab/aurora/commit/629d98bb087521ca98b555484eef57f6e2c49717))
* **terminal:** terminal real no TCMD (xterm.js + PTY) — input inline, autocomplete, cópia, links ([4303f14](https://github.com/nipscernlab/aurora/commit/4303f14fbfe94fbf952ad3082ad69a3e400f6a36))
* **titlebar:** liga a &lt;aurora-titlebar&gt; ao vivo (sem shadow DOM, preserva app-region) ([806fb04](https://github.com/nipscernlab/aurora/commit/806fb04bb268d5508d0f649a793f9fe949c3d26e))
* **tokens:** add the DESIGN §3 semantic layer + tokenize z-index literals (Lit shell Fase A) ([37b4094](https://github.com/nipscernlab/aurora/commit/37b409482ec5430aa26f960f203cc3143a9e0c5c))
* **tree:** &lt;aurora-tree&gt; — shell semântico do file tree (Lit step 1) ([31287b7](https://github.com/nipscernlab/aurora/commit/31287b7cb47d19e1e6289cce7a73600b51b39fbe))
* **tree:** arrastar e soltar na visao Folder, e o icone segue o que se digita ([91ff01d](https://github.com/nipscernlab/aurora/commit/91ff01d7c51e285fef2289b01fc211b5f4e4a9f6))
* **tree:** criar .gitignore pelo menu da file tree (com defaults SAPHO) ([b017b8f](https://github.com/nipscernlab/aurora/commit/b017b8f47f07cbc002882c40a33911248722259a))
* **tree:** Ctrl+Z e Ctrl+Shift+Z para criar, renomear, mover e deletar ([e8cff89](https://github.com/nipscernlab/aurora/commit/e8cff8962dad96c08338d2b0e2cc52977e4f97f0))
* **tree:** decoracoes de status git na file tree (estilo VS Code, ambas as views) ([d2aa1d8](https://github.com/nipscernlab/aurora/commit/d2aa1d8210cbca04a187a199213721fb7e2844c2))
* **ui:** command palette (Ctrl+K / Ctrl+Shift+P) ([32f1ae7](https://github.com/nipscernlab/aurora/commit/32f1ae7b1407c480409ae6b4ff5f1c6b6fc837bf))
* **ui:** ícone de colapsar da file tree → ph-minus-square (glifo do ([711dfd4](https://github.com/nipscernlab/aurora/commit/711dfd4a953dee9374b28e662135e2a4c55f9764))
* **ui:** raio de foco na arvore e gradiente no foco de input ([aa3ce9e](https://github.com/nipscernlab/aurora/commit/aa3ce9ed8e9161375bd33876e1bfd943fd297d82))
* **ui:** relatar um problema por e-mail, com o diagnostico ja preenchido ([c435265](https://github.com/nipscernlab/aurora/commit/c4352653c388c6d3367d1b01e69be25e7230b1fb))
* **ui:** sete ajustes de interface pedidos em 08/08/2026 ([b22deb9](https://github.com/nipscernlab/aurora/commit/b22deb935e40b03a298ae8dbef2ce8d725be1a48))
* **ui:** trilho de borda traz de volta a arvore e o painel de IA colapsados ([082837d](https://github.com/nipscernlab/aurora/commit/082837ddfbbaa1290a5824f9256eac6ad5c27d2e))
* **updater:** agendamento com retentativa, retomada de download e diagnostico ([36f867c](https://github.com/nipscernlab/aurora/commit/36f867cc3aab34cc88b402518b469fe72500dcbf))
* **updater:** instala ao fechar; documenta delta e implantacao no laboratorio ([4d9fcce](https://github.com/nipscernlab/aurora/commit/4d9fcce0d110aced9997061a72525a7bee3dc4c9))
* **ux:** three quality-of-life wins — .spf highlight, welcome processor hover, chat follow-up queue ([016230c](https://github.com/nipscernlab/aurora/commit/016230c0f60b68ff7bbe5049ab405711d81387ff))
* **wave:** auto-gerar layout curado do Surfer (.surf.ron) — buildSurferLayout ([115c329](https://github.com/nipscernlab/aurora/commit/115c3290081280810059d1706d136f65b2780683))
* **wave:** decode de Assembly/C± no Surfer + tracks de instrução sempre visíveis ([25d258a](https://github.com/nipscernlab/aurora/commit/25d258a8da26eaacbd486d8987ceb019386e8ff1))
* **wave:** decode de números complexos no Surfer (pre-pass via comp2gtkw) ([e037184](https://github.com/nipscernlab/aurora/commit/e03718408cc7bd8b6ed809e71919fd3cc35ea7e8))
* **wave:** grupos colapsaveis por processador no Surfer (.surf.ron) ([1b1ba48](https://github.com/nipscernlab/aurora/commit/1b1ba48b2a47a0f3cd04e6b79322d515a0e38006))
* **wave:** labels Assembly/C+- por nome do processador + dividers coloridos no Surfer ([08edb3d](https://github.com/nipscernlab/aurora/commit/08edb3da9ca0647fb39de5b9569d626ea58db0ce))
* **wave:** logos reais de GTKWave e Surfer nos botões do toggle de viewer ([21a7d67](https://github.com/nipscernlab/aurora/commit/21a7d67d37ee7e54fa6ed5d6d98c0626ecc51036))
* **wave:** markers automaticos de latencia no Surfer (entrada -&gt; saida) ([4f206ca](https://github.com/nipscernlab/aurora/commit/4f206cad4fda85a17ccd4951d2ccfc879d358ad6))
* **wave:** O3 — streamar o build do Verilator (antes ~10-60s mudo) ([63cff45](https://github.com/nipscernlab/aurora/commit/63cff4512c6e8f318ba6f0de5622feff301efffd))
* **wave:** polish do Surfer — floats como analog (curva DSP) + clk/rst meia-altura ([f8b2e5b](https://github.com/nipscernlab/aurora/commit/f8b2e5bb9efa6cdf0d0eb32e5dc785cbfa0e27eb))
* **wave:** robustez dos mappings do Surfer — anti-staleness, namespacing, escrita atomica ([d59b225](https://github.com/nipscernlab/aurora/commit/d59b2253728709541249faf17272b3d66a966d2d))
* **wave:** simulacao roda na pasta do testbench em projeto puro-HDL ([1877280](https://github.com/nipscernlab/aurora/commit/1877280c45789914ce77c307ef3c348e589b83b3))
* **wave:** Surfer como viewer opt-in ao lado do GTKWave (toggle + API da IA) ([2a343ee](https://github.com/nipscernlab/aurora/commit/2a343ee67306bab82b6dcd256536adc7492f2dfb))
* **wave:** Surfer layout files (.surf.ron/.sucl) — picker viewer-aware + 6 AI tools + janela centralizada ([a9f3337](https://github.com/nipscernlab/aurora/commit/a9f333787b9dd8b0be7965691ea7953958940a6f))
* **wave:** toggle de varias janelas do Surfer no modal Wave Configuration ([43f315b](https://github.com/nipscernlab/aurora/commit/43f315b7c39068b13e95a1fd971cd5149d331bc6))
* **wave:** trio de quick-wins do Surfer — auto-reload, folding curado, pre-checks ([7486e19](https://github.com/nipscernlab/aurora/commit/7486e19c099df606c9da4ed99d019aadedf26c2f))
* **welcome:** aurora — taller, mountain-varied heights + more visible filetes (still continuous) ([6dce182](https://github.com/nipscernlab/aurora/commit/6dce182be0fb95e136bd397b90b0520dd716280d))
* **welcome:** re-estiliza card de processadores (DESIGN.md) ([c184439](https://github.com/nipscernlab/aurora/commit/c184439afacaa62ade4e5b1782227d6e20350b18))
* **welcome:** realistic continuous aurora ribbons — green body, magenta/pink tips ([a57482a](https://github.com/nipscernlab/aurora/commit/a57482a146c9c275b5b4f151c4009158c45afc47))
* **welcome:** redesign the ambient aurora as a bottom-anchored filament landscape ([9051671](https://github.com/nipscernlab/aurora/commit/90516710168d5d65ec606149f2c5478b1755a161))


### Bug Fixes

* **ai:** brilho do painel agora lilas, mais longe e sem efeito-GIF ([5724a03](https://github.com/nipscernlab/aurora/commit/5724a03b2b2c5b16baf05be0796159dcc83f4aa5))
* **ai:** brilho vira bolha de luz no rodape — mais intenso e mais vivo ([e869c95](https://github.com/nipscernlab/aurora/commit/e869c955a8d8ab9e5d57d222b0a44ace5f3ba4b1))
* **ai:** card de AskUserQuestion em modo bypass + modelos/efforts atuais (Claude/Codex) ([538cb47](https://github.com/nipscernlab/aurora/commit/538cb470e176e71f127492dca074dedb0066a797))
* **ai:** card do AskUserQuestion nunca renderizava no caminho do SDK ([0e8d7c4](https://github.com/nipscernlab/aurora/commit/0e8d7c472cab30867f4097121f6a723daa89b7d2))
* **ai:** clean attachment temps at startup only (not on quit) + docs notes ([f0877e4](https://github.com/nipscernlab/aurora/commit/f0877e45bca088fb1a3f746c2afb67d8b8ba38e6))
* **ai:** descreve os 50 parametros mudos do manifesto, e trava isso em teste ([bcc15de](https://github.com/nipscernlab/aurora/commit/bcc15ded304b2c66866cd535e1ec1c81b68371c9))
* **ai:** fila de follow-up era inalcancavel pelo teclado ([a51b651](https://github.com/nipscernlab/aurora/commit/a51b65105efba2b41d31c72d5c204da99b1b18b2))
* **ai:** imagens voltam a chegar ao modelo + anexo persiste ao reabrir + glow na 1a msg ([3395951](https://github.com/nipscernlab/aurora/commit/33959511ebd5775f2f63ef74797a02fdc4a3b40a))
* **ai:** kill the AI-chat freeze — backend inactivity timeout + watchdog hard ceiling ([bca7b46](https://github.com/nipscernlab/aurora/commit/bca7b4620431239467230f06a9fba921689c77da))
* **ai:** LaTeX \text no chat + agente fora da pasta do projeto destrava o rename ([6a01ddb](https://github.com/nipscernlab/aurora/commit/6a01ddbaed5cb70d6c94f034d62683476aff6aae))
* **ai:** note/question do card de permissao saiam como codigo ([50d9dbb](https://github.com/nipscernlab/aurora/commit/50d9dbbfd9ec4c8891b8930d28b892d3d0f951e3))
* **ai:** o painel de IA discordava de si mesmo sobre estar aberto ([082837d](https://github.com/nipscernlab/aurora/commit/082837ddfbbaa1290a5824f9256eac6ad5c27d2e))
* **ai:** o system prompt continuava dizendo slang-server 0.2.7 ([af43d0d](https://github.com/nipscernlab/aurora/commit/af43d0d8542712c6a71cd70dd85466fe91271357))
* **ai:** o system prompt sabia coisa errada sobre o yanc e nao sabia o que vem no pacote ([4e1b46c](https://github.com/nipscernlab/aurora/commit/4e1b46c06a7fe7a7925fe6e579f210d3a9bd618e))
* **ai:** rename de projeto/processador volta a ser mecanico (sem card que trava) ([1d3210e](https://github.com/nipscernlab/aurora/commit/1d3210e34a28cd3b2577d6e805248df4dc7cf99c))
* **ai:** stop AI image-attachment temp files from leaking ([2800cb5](https://github.com/nipscernlab/aurora/commit/2800cb5aa6f4028b4951b9ecb561468b4901a15c))
* **ai:** superficie de tools nativas vira allowlist (23 -&gt; 7) ([08be96d](https://github.com/nipscernlab/aurora/commit/08be96d87ca226d270896220c26350818cf0d5ce))
* **ai:** tornar o brilho do painel visivel — banda acima do composer + mais presenca ([604f567](https://github.com/nipscernlab/aurora/commit/604f56785aa96baf2c7b42d9a0cd8744c25bbfe0))
* **aurora:** legibilidade do texto + menos aliasing dos filamentos no welcome ([f3bd52c](https://github.com/nipscernlab/aurora/commit/f3bd52c9e702ffe663df1fa432c511fbf00e85d0))
* **build:** codex-sdk voltava a faltar no pacote; -241MB de binario morto ([33de346](https://github.com/nipscernlab/aurora/commit/33de3462c70ba72605f5b04b16d4f2e45cffb5f9))
* **ci:** check-i18n nao falha no proprio exemplo (…) + handoff p/ migracao de maquina ([5fcab41](https://github.com/nipscernlab/aurora/commit/5fcab41b1f308b0c9f10962cb409e545ae9e80da))
* **ci:** conserta a main apos os merges sem verificacao e tira o manual do lint ([8985a78](https://github.com/nipscernlab/aurora/commit/8985a78da7728c56dc8430a4cabcc7b1a21169cd))
* **cocotb:** testbench reprovado era reportado como simulacao bem-sucedida ([1e9607a](https://github.com/nipscernlab/aurora/commit/1e9607ac1e094f2d8f3c68e3487282ede79dd53d))
* **compile:** cancelar vira autoridade sobre o fluxo; barra suave; scroll livre ([dfcad0f](https://github.com/nipscernlab/aurora/commit/dfcad0fd2037a14e175b64d1dd51668c8ea76189))
* corrige acronimo SAPHO para 'Scalable Architecture Processor for Hardware Optimization' ([cef955c](https://github.com/nipscernlab/aurora/commit/cef955c187fb3fb92dcf673e7f42e3e66bdeb0c6))
* **css:** corrige meu erro anterior sobre o arrasto, e troca sombra por luz ([f51b36f](https://github.com/nipscernlab/aurora/commit/f51b36fcee4b4fba7fa121bc357671dabe673a4f))
* **deps:** js-yaml 4.3.1 e declara a dependencia que o patch-latest-yml usava ([fb80467](https://github.com/nipscernlab/aurora/commit/fb80467e2e7a95b2ed4325a397b4b86a34ee8a78))
* **deps:** pin Claude Code/Codex exatos — npm re-resolvia e travava o npm start ([b8fedce](https://github.com/nipscernlab/aurora/commit/b8fedceca0e93d71bebbdd21e31ef004924be68e))
* **deps:** restaura o package-lock que eu dessincronizei ([f6691ec](https://github.com/nipscernlab/aurora/commit/f6691ec331fd1714a835079b258e72a1217c123b))
* **dev:** spawn Vite directly so the dev server stays up (fixes PRISM/Monaco/close) ([b180961](https://github.com/nipscernlab/aurora/commit/b180961b2d7b4579ebdf510df28c1ca31bbfb095))
* **e2e:** o teste de layout media a tela da maquina, e nao o comportamento ([4d36bb1](https://github.com/nipscernlab/aurora/commit/4d36bb1ea82fe8ae253af92a9f749a8ba03bc69a))
* **editor:** A5 — the four real mapping bugs (find-state, PDF snapshot, dead code) ([7fd8df6](https://github.com/nipscernlab/aurora/commit/7fd8df6f739491550f35500359ddd2387bbad434))
* **editor:** anchor Monaco's vs path to an absolute URL (file:// worker load) ([37fb696](https://github.com/nipscernlab/aurora/commit/37fb696d20ca82323dbc85848bd05c6230ac6b62))
* **editor:** drop editor.blur() — not a Monaco method (P1) ([da53b7b](https://github.com/nipscernlab/aurora/commit/da53b7b286fada4c36bad8f1f511a79d596a5115))
* **errors:** anexa a causa ao relancar erro dentro de catch ([d4a2c14](https://github.com/nipscernlab/aurora/commit/d4a2c1432285ab4b87c3240793e3c2cc431a2ba5))
* **fonts:** real bold/medium — use the variable fonts with a font-weight range ([663b9e3](https://github.com/nipscernlab/aurora/commit/663b9e3fa888378c9da4ca1de859338ceb455f02))
* **fonts:** troca a Norse por Metamorphous e Noto Sans Runic, as duas sob OFL ([50bdc10](https://github.com/nipscernlab/aurora/commit/50bdc10ecf883f1167217856cf1549a78c93beea))
* **git/ui:** diff sem travar (file-list lazy, multi-arquivo, sem binarios) + ESC + i18n dinamico ([7282956](https://github.com/nipscernlab/aurora/commit/72829568128db5d22c4ee82306343a1edcbda29b))
* **git+ai:** feedback no painel (sem toasts), commit travado sem mudancas; brilho calmo ([70d7ecc](https://github.com/nipscernlab/aurora/commit/70d7ecc6cb21718944872b4a8df9cf649415985b))
* **git:** abrir projeto via loadProject (processadores voltam) + todas as branches ([0001d24](https://github.com/nipscernlab/aurora/commit/0001d2476963cb368bae43bb13826fda86862e21))
* **git:** checkout de branch remota (--track) + restaurar stash com conflito + alinhar i ([0d09af0](https://github.com/nipscernlab/aurora/commit/0d09af0008f3a876ec7fbc9e846203d9bb25f9ad))
* **git:** diff nunca trava (gate por nº de linhas + cap rígido) + libera memória ao fechar + UI do code ([bbd519a](https://github.com/nipscernlab/aurora/commit/bbd519a9d46808c5bef3a501b33c243b79001342))
* **git:** foco da Aurora apos autorizar OAuth + code box/painel "i" alinhados ([d4f24f8](https://github.com/nipscernlab/aurora/commit/d4f24f8602fd2fe1138c2071d7e1b040f15b465f))
* **git:** foto de perfil de volta, toggle privado/publico, erro de token claro ([b1070de](https://github.com/nipscernlab/aurora/commit/b1070de468b9b81e73d7c331a4883b363c98ec5c))
* **git:** menu de branches (body-portal), painel rolavel, pull&push e mais ([8bac558](https://github.com/nipscernlab/aurora/commit/8bac55896a957e2f6ed619b6c15355e8c4bd5680))
* **git:** mostrar o codigo do device flow (listener no objeto certo) + cancelar/tentar de novo ([f3e0df9](https://github.com/nipscernlab/aurora/commit/f3e0df9b047580594c255c238b57e6a777b7ac56))
* **git:** pull --autostash, status nao redimensiona o modal, badge menor + auto-update, tooltips ([0866888](https://github.com/nipscernlab/aurora/commit/086688812d255fa64a1fb23a6e9e005ee0a5bbc2))
* **i18n:** os dois botoes do trilho de borda apontavam para chaves que nao existiam ([3a97f62](https://github.com/nipscernlab/aurora/commit/3a97f626d173968426ac443e889be6edfb77156e))
* **jumplist:** para de tentar a categoria "Recent Projects" quando o Windows recusa ([e73b032](https://github.com/nipscernlab/aurora/commit/e73b032f64524ae6bb2500ceebd19b2ca98da61e))
* **layout:** a largura permitida vale nos tres caminhos, e nao so no arrasto ([d30f734](https://github.com/nipscernlab/aurora/commit/d30f734a51284b55f2ae0900be82d9053acdfc6f))
* **layout:** o divisor do canto tinha a propria copia da regra, com o bug antigo ([9368d79](https://github.com/nipscernlab/aurora/commit/9368d79f9fc6f8247f6d979365f50703815694ea))
* **log:** para de registrar como erro o que e condicao esperada ([58f367d](https://github.com/nipscernlab/aurora/commit/58f367d30e7aa932c871fce5482dda6b23700fdd))
* **notification:** reposicionar o stack de toasts (estavam full-width no rodape) ([7f2a57b](https://github.com/nipscernlab/aurora/commit/7f2a57b2af61349892bac3febff49c83e7431936))
* padroniza acrônimo SAPHO com hífen (Scalable-Architecture Processor for Hardware Optimization) ([0aec485](https://github.com/nipscernlab/aurora/commit/0aec4857bbeaf8e770852e8ccfb663961aee5a86))
* **preview:** estilos ausentes do preview md/html (lupa, respiro, iframe) ([4affdf7](https://github.com/nipscernlab/aurora/commit/4affdf710e772d59ea0ec8120c5c5056ddd6801b))
* **preview:** HTML renderizado abria branco (CSP herdada pelo blob:) ([ec839b3](https://github.com/nipscernlab/aurora/commit/ec839b35e09df2328901f65b16202aebfce74c38))
* **prism:** "Simular" travava em designs grandes (sem timeout/guard de tamanho) ([f64b515](https://github.com/nipscernlab/aurora/commit/f64b51581e2067bfe3fdea5e9faa646ef8699ce8))
* **prism:** carrega jquery-ui no jQuery global antes do digitaljs ("e.widget") ([52696d9](https://github.com/nipscernlab/aurora/commit/52696d9cefb1677d11622c0034e3e3ee4f298e9d))
* **prism:** dígito 0/1 legível e alinhado à caixinha (era branco/deslocado) ([32d7ac8](https://github.com/nipscernlab/aurora/commit/32d7ac89f3ef14907a22a152f36995aa510d7c3d))
* **prism:** PRISM não carregava — digitaljs (jquery-ui) quebrava no module-load ([e3905f8](https://github.com/nipscernlab/aurora/commit/e3905f87f18bcb38ccb980d5c5af470fb24c1d07))
* **project:** file tree clicavel apos rename (remove setProject redundante) ([a366ac3](https://github.com/nipscernlab/aurora/commit/a366ac31c497285e8cf934a19a8622c50b6ae541))
* **project:** project:getInfo tolerates a folder path (was crashing EISDIR) ([7f49d78](https://github.com/nipscernlab/aurora/commit/7f49d7872ca4d28e6b3db2b94ad6a4dca87b3266))
* **resize:** a suspensao da transicao no arrasto nao existia ([54430f0](https://github.com/nipscernlab/aurora/commit/54430f082709b73aba609a34a2bd4ab86ec4f76b))
* **resize:** colapso ao forcar e teto que respeita os vizinhos ([b705c41](https://github.com/nipscernlab/aurora/commit/b705c41476bf4992a69f62874fbdffd149befa58))
* **resize:** place corner handles via ResizeObserver so they work on first hover ([4566fe5](https://github.com/nipscernlab/aurora/commit/4566fe52550d1dfa745da6dfa5f4d5a578ae279a))
* **shell:** command palette — kill the click-wall when closed; panel like the modals ([5043ec2](https://github.com/nipscernlab/aurora/commit/5043ec2ac647b38df2235a1f3be129e672f44624))
* **slang:** atalho dedicado Ctrl+Alt+S pro toggle (Ctrl+Shift+P é do command palette) ([e1902fc](https://github.com/nipscernlab/aurora/commit/e1902fc58c8eed47680be1c05a45f8322f467539))
* **surfer:** emite os 3 campos obrigatorios do WaveData no .surf.ron ([ca78ab6](https://github.com/nipscernlab/aurora/commit/ca78ab6e929192060d43e30d105aca016571562d))
* **tabs:** Ctrl+W fecha UMA aba (remove o handler de atalho duplicado) ([54ee29b](https://github.com/nipscernlab/aurora/commit/54ee29b3f3bb919c4331b6d151b0ae4d8ba8bdc4))
* **tabs:** Ctrl+W no longer closes every tab (+ no null-layout crash) ([d05bebc](https://github.com/nipscernlab/aurora/commit/d05bebcf0842b878e2256b304626e3afcab8cce8))
* **temp:** tambem limpa components/Temp no startup (rede contra crash) ([6f78fe7](https://github.com/nipscernlab/aurora/commit/6f78fe7a6e2bded7f78bef7ed2290c88eec9a05f))
* **terminal:** a lista de abas se instala sozinha, sem depender do onload ([5499fab](https://github.com/nipscernlab/aurora/commit/5499fab5056c51682d91caa62dff8922e01f0c46))
* **terminal:** as abas encolhem em vez de serem cortadas na borda do painel ([917eb5f](https://github.com/nipscernlab/aurora/commit/917eb5fc2023cfc7131e987f46e5d25bb7840dac))
* **terminal:** auto-scroll robusto + barra de progresso interpolada ([47f6784](https://github.com/nipscernlab/aurora/commit/47f67845e5db903f16c5751b9ff6d50b11896e95))
* **terminal:** Ctrl+C/V duplicado no TCMD — attachCustomKeyEventHandler ([711dfd4](https://github.com/nipscernlab/aurora/commit/711dfd4a953dee9374b28e662135e2a4c55f9764))
* **terminal:** entrar num terminal sempre rola pro fim ([5ec3a42](https://github.com/nipscernlab/aurora/commit/5ec3a428bb4f1595cf1d2268b6ca08921ad4acb8))
* **terminal:** follow com teto de velocidade + gruda no fim ao trocar de aba ([fb2a8c5](https://github.com/nipscernlab/aurora/commit/fb2a8c52c23e4fa4dea81594937c0ff3e54a8fa7))
* **terminal:** o vao acima do terminal era o CSS discordando do JS ([442eff6](https://github.com/nipscernlab/aurora/commit/442eff6617cbd6b80f340a08d07aec2b642bc4f0))
* **terminal:** scrollbar visivel e agarravel + follow suave; teardown re-armavel ([f1d6f69](https://github.com/nipscernlab/aurora/commit/f1d6f69b8d9ca6979387b8a7dbc9e2aa35d88081))
* **tree:** atualiza o aviso de arquivos faltantes ao re-importar (refreshTree sempre) ([85959e7](https://github.com/nipscernlab/aurora/commit/85959e7894034f70892a970741b356cd1decb285))
* **tree:** highlight de arquivo aberto distinto do top-level + muted ao perder foco (estilo VSCode) ([9826561](https://github.com/nipscernlab/aurora/commit/9826561b34631c2f678409df0a97f733fd405000))
* **ui:** anel de foco deixa de riscar a borda do terminal e do chat ([442eff6](https://github.com/nipscernlab/aurora/commit/442eff6617cbd6b80f340a08d07aec2b642bc4f0))
* **ui:** command palette no longer blocks the IDE after closing ([99ec95a](https://github.com/nipscernlab/aurora/commit/99ec95a25832c05b9fd087c7b3d3d2ea9443b56c))
* **ui:** command palette on Ctrl+Shift+K (Ctrl+K is reserved for the AI panel) ([d82c034](https://github.com/nipscernlab/aurora/commit/d82c034ca98fa412e4b2cb22e24c8815cc24425b))
* **ui:** error boundary ignora cancelamento benigno do Monaco (rename nao alarma) ([e4aea07](https://github.com/nipscernlab/aurora/commit/e4aea072cad23ab45c8bf27a9a98dc435f63faef))
* **viewer:** pan the image by transform, not scroll, so zoomed edges are reachable ([2348cf2](https://github.com/nipscernlab/aurora/commit/2348cf2fe82df86d42d75ff8ad45c7e7d4344724))
* **wave:** a janela de Markers do Surfer abria vazia porque o marcador nunca era emitido inteiro ([e52995a](https://github.com/nipscernlab/aurora/commit/e52995a57b534fb3924d84ef0da58f770c13f3cc))
* **wave:** clk/rst no Surfer 0.5-&gt;0.8 de altura (0.5 encavalava o rotulo) ([41f5d9b](https://github.com/nipscernlab/aurora/commit/41f5d9b181917e34d72f465b1afeb64acba6e754))
* **wave:** signal rows use a sine-wave icon, not the ECG-style pulse ([912325e](https://github.com/nipscernlab/aurora/commit/912325e12b4b4e467b9a447ebe60915c20b0d5fb))
* **wave:** Surfer abre UMA janela por simulacao + label correto; auto-reload nao funciona no Windows ([a67002e](https://github.com/nipscernlab/aurora/commit/a67002ead9f345656b3189661502b62ccd8032bd))
* **welcome:** aurora — fuller spectrum, dimmer, a touch sparser (final polish) ([58903d1](https://github.com/nipscernlab/aurora/commit/58903d1c3b0bafd00fe7a8b1ad114936296112a2))
* **welcome:** aurora — nudge the morph speed up a touch (0.16 -&gt; 0.21) ([7fd9e7a](https://github.com/nipscernlab/aurora/commit/7fd9e7a38177b58c469dad16e8afb48491e296f9))
* **welcome:** aurora filetes — ragged varied heights + denser, fill the bottom edge ([963d32c](https://github.com/nipscernlab/aurora/commit/963d32ceb11c31c65e10c8179ce49cd8d4a5e95b))
* **welcome:** aurora movement — kill the linear pan, slow the morph way down ([837cc3a](https://github.com/nipscernlab/aurora/commit/837cc3add129cce7652ea6dbe0d3b3e91bc29522))
* **welcome:** aurora resolution-independent (no resize squish), reaches the bottom, fills holes ([9b567bf](https://github.com/nipscernlab/aurora/commit/9b567bfbc38bdba9c9e1117a5e0a17e1063647ee))
* **welcome:** aurora was incoherent — drop the competing layers, keep one coherent skyline ([23ec10d](https://github.com/nipscernlab/aurora/commit/23ec10d1daf67f124cd3c9e388c9a88b0da7aa1b))
* **welcome:** aurora was too masked — brighten the curtains + relax the top fade ([ec71bf4](https://github.com/nipscernlab/aurora/commit/ec71bf4e382275cff0efb0207d803d8dd768d383))
* **welcome:** drop the aurora to a thin bottom band ("filete") ([1242d39](https://github.com/nipscernlab/aurora/commit/1242d39c386247c89745c3ff93353811912370e1))
* **welcome:** redo the aurora as a faithful nimitz "Auroras" port (the from-scratch one read as fog) ([7fb46a4](https://github.com/nipscernlab/aurora/commit/7fb46a4b1f85c38068835ec00ff4fb0d27d70a0b))
* **welcome:** render the processor-hover popover at body level (AI-panel position bug) ([3953117](https://github.com/nipscernlab/aurora/commit/3953117b4cc8baa24bc69f3c573d7e0e3f832f31))
* **welcome:** show the processor-hover popover to the LEFT of the row ([a920fe5](https://github.com/nipscernlab/aurora/commit/a920fe5f1d6cfed172832583ac835630398cba64))


### Performance

* **ai:** higiene de memória — strip base64 dataUrl após captura (§D item) ([64b3ae7](https://github.com/nipscernlab/aurora/commit/64b3ae7927aead967d08ba61e6e820afd4bae756))
* **aurora:** limita fps e resolucao do fundo aurora (trava na welcome) ([380d1f6](https://github.com/nipscernlab/aurora/commit/380d1f6b5104f10ec981558812d3b115aac094a6))
* **aurora:** qualidade cheia ou nada - gate remove o efeito em GPU fraca ([47ab73d](https://github.com/nipscernlab/aurora/commit/47ab73d54d541168d56307bd8438d3885adaa579))
* **aurora:** usa GPU dedicada (high-performance) no fundo aurora ([8313b62](https://github.com/nipscernlab/aurora/commit/8313b620113bbf9546d7eba0821ed046edbd2f26))
* **css:** drop wasted backdrop-blur on tooltip + context menu (P8b) ([e71eca3](https://github.com/nipscernlab/aurora/commit/e71eca3cbe99faa01c31de90308696a01d3edeff))
* **editor:** decorate only the visible range; drop per-keystroke find query (P11) ([17ff32e](https://github.com/nipscernlab/aurora/commit/17ff32e179baf584403d0f1e9a5fc4a63f8b4950))
* **editor:** one Monaco editor for the main pane, switch files via setModel (P1) ([a5ae761](https://github.com/nipscernlab/aurora/commit/a5ae761aef25b11e7b721e2be261dd1ea8c9caba))
* **gpu:** forca a GPU dedicada no app inteiro (force_high_performance_gpu) ([497f035](https://github.com/nipscernlab/aurora/commit/497f035f383c265dc9781b9d42721919b64dbfb3))
* **init:** make Monaco + TabManager init idempotent; dedupe refresh (P5) ([a4ff60c](https://github.com/nipscernlab/aurora/commit/a4ff60c5908ea507b29f906e6b6aef54bc478f27))
* **main:** one idle-aware watcher health check, unref'd (P16) ([af66c1d](https://github.com/nipscernlab/aurora/commit/af66c1d17c4838e22717c27b10593de27208a2b6))
* **paineis:** o arranque animava a largura salva, e ninguem tinha pedido animacao ([25a43f3](https://github.com/nipscernlab/aurora/commit/25a43f3ad4f517842d859db0ab5298fb3a65bf6b))
* **shutdown:** stop the expensive process sweeps on every clean close ([64d6536](https://github.com/nipscernlab/aurora/commit/64d6536712f77a63a7ed07330ee8a8e6736e6fe3))
* **tabs:** poll open files for external changes only while focused (P15) ([7595c7b](https://github.com/nipscernlab/aurora/commit/7595c7b4d31ecf55af500378131be176638a7182))
* **terminal:** aurora-terminal passo 2 — cap por card + content-visibility ([5aa64cf](https://github.com/nipscernlab/aurora/commit/5aa64cf935dcb12ab60ab38305cc80956e058b4c))
* **terminal:** contain:layout on the streaming log body (P7) ([b7a3b03](https://github.com/nipscernlab/aurora/commit/b7a3b0329227ab487d927f868c92194960e6b55c))
* **terminal:** throttle recount + filter off the per-frame path (P10) ([c64c3c4](https://github.com/nipscernlab/aurora/commit/c64c3c445de55a7eb6def886555d22211f7556bd))
* **tree:** aurora-tree passo 2 — endurecimento (sem virtual scroll) ([5f7255d](https://github.com/nipscernlab/aurora/commit/5f7255ddc60482eced8105a4f7646d57a894de91))
* **tree:** batch standard-tree DOM into a fragment — no expand freeze (P9) ([af375da](https://github.com/nipscernlab/aurora/commit/af375da3c71a6c4629862145060c7f7934863db6))
* **tree:** cache verilog classification by mtime (P3) ([32aee2a](https://github.com/nipscernlab/aurora/commit/32aee2a6d069be3307a3a7f713a887f483330206))
* **tree:** render coalescido sem perder mudanca, e estudo medido ([987b2f9](https://github.com/nipscernlab/aurora/commit/987b2f93909072de97257e08080f55522eab1cd3))


### Refactor

* **a2:** extrai ai_metadata do ai_assistant_manager (AI-3) + testes ([df357d0](https://github.com/nipscernlab/aurora/commit/df357d0e1bf8a815ad2d00e28ce48167cd40d5b4))
* **a2:** extrai chat_render do ai_assistant_manager (AI-2, absorve AI-4) + testes ([54722b2](https://github.com/nipscernlab/aurora/commit/54722b213abcd53ecc68a177cd4496b5da13feba))
* **a2:** extrai file-type/icone do tab_manager (TM-2) + testes ([c9c08c8](https://github.com/nipscernlab/aurora/commit/c9c08c8c69e7df96f0b7177425e93cddb2a5089b))
* **a2:** extrai hierarchy_parser do compilation_module ([#1](https://github.com/nipscernlab/aurora/issues/1)/5) + testes ([eb14e3f](https://github.com/nipscernlab/aurora/commit/eb14e3fc8a2f304347c19e2b7c3f2ea25751ea01))
* **a2:** extrai hierarchy_view do compilation_module ([#2](https://github.com/nipscernlab/aurora/issues/2)/5) ([4eecdf7](https://github.com/nipscernlab/aurora/commit/4eecdf7dcd0612b4309895be4ecb88cb0263bd10))
* **a2:** extrai history (lista + serializacao) do ai_assistant (AI-10) + testes ([b8345e1](https://github.com/nipscernlab/aurora/commit/b8345e19075478af2b4492e067aad3e5aa10731f))
* **a2:** extrai logica do permission-gate do ai_assistant (AI-8) + testes ([c04f843](https://github.com/nipscernlab/aurora/commit/c04f843bcf7994f9d7c83904a86f192c4923a7ea))
* **a2:** extrai markup de anexos do ai_assistant (AI-6) + testes ([55d8051](https://github.com/nipscernlab/aurora/commit/55d8051df96e88726f4d54df85a4fa7a850aa150))
* **a2:** extrai matematica de scroll do ai_assistant (AI-5) + testes ([cc4f347](https://github.com/nipscernlab/aurora/commit/cc4f347abb83b694cbf912756c36f1bb226d4404))
* **a2:** extrai processor_compiler do compilation_module ([#5](https://github.com/nipscernlab/aurora/issues/5)/5) + testes ([3c2f459](https://github.com/nipscernlab/aurora/commit/3c2f459677c9b102c4fb05fbdba7ab03ab0ce4e6))
* **a2:** extrai provider/model view do ai_assistant (AI-9) + testes ([1eb1fed](https://github.com/nipscernlab/aurora/commit/1eb1fed119b1d43bec4614dc3f09a10d5d207c9f))
* **a2:** extrai save-name helpers do tab_manager (TM-3) + testes ([6bd6528](https://github.com/nipscernlab/aurora/commit/6bd652839b4c8ef631b04ad80f1d4ca036883eaa))
* **a2:** extrai shaping do turn do ai_assistant (AI-11) + testes ([3fad47a](https://github.com/nipscernlab/aurora/commit/3fad47a670567a9662fc8d7c49c41dbbb7092292))
* **a2:** extrai strip de tool-call inline do ai_assistant (AI-7) + testes ([bd1e05d](https://github.com/nipscernlab/aurora/commit/bd1e05db68d3de2398659bc5e92cb801c8daa88d))
* **a2:** extrai system_prompt do ai_assistant_manager (AI-1) + smoke test ([b654b4d](https://github.com/nipscernlab/aurora/commit/b654b4d296242eea5ba447b2c9d189ecdee1711a))
* **a2:** extrai tab_utils do tab_manager (TM-1) + testes ([0b2eb53](https://github.com/nipscernlab/aurora/commit/0b2eb530e76e8bf0655537a522bc8df3622ae62b))
* **a2:** extrai untitled metadata puro do tab_manager (TM-4) + testes ([12d7a74](https://github.com/nipscernlab/aurora/commit/12d7a747d0a1a3d4db8fa3c78ff76de4d34e95b3))
* **a2:** extrai wave_signal_validator do compilation_module ([#4](https://github.com/nipscernlab/aurora/issues/4)/5) + testes ([2a57e47](https://github.com/nipscernlab/aurora/commit/2a57e4750198f7100b5873cd5a70d9185e0736e3))
* **a2:** extrai wave_toolchain do compilation_module ([#3](https://github.com/nipscernlab/aurora/issues/3)/5) + testes ([e03c07e](https://github.com/nipscernlab/aurora/commit/e03c07ecfe9664f53f772437e3ca94db8e416ecc))
* **a3:** electron_api vira handle LIVE (Proxy) + .d.ts ([5502105](https://github.com/nipscernlab/aurora/commit/5502105440ff86470a97409ae84ca41c613d9025))
* **a3:** migra window.electronAPI -&gt; import em 22 modulos .js ([fb3728b](https://github.com/nipscernlab/aurora/commit/fb3728b4133f590db90d6761d0a61f2ebd55173a))
* **a3:** migra window.electronAPI -&gt; import nos 4 modulos .ts ([44610af](https://github.com/nipscernlab/aurora/commit/44610aff4182f19b685853788659540458c57258))
* **a3:** migrar globais electronAPI -&gt; import (parcial: modulo + 15 arquivos) ([6bc67d4](https://github.com/nipscernlab/aurora/commit/6bc67d4a32777e1e2a2fcdbb3676be91b49bea91))
* **ai:** refresh the SAPHO prompt + rules to YANC v5.2 (facts + dedup) ([1e5a8c4](https://github.com/nipscernlab/aurora/commit/1e5a8c45d6a27d0b19f96b77d53185054235f45a))
* **api:** extrai o nucleo da AuroraAPI para um modulo sem imports ([647107f](https://github.com/nipscernlab/aurora/commit/647107f7739ae14fcc32835848273cf4f3fab11b))
* **B5:** testes importam .ts direto; .js gerados saem do git ([29ebbab](https://github.com/nipscernlab/aurora/commit/29ebbaba840d512be018947b3626f0f74447636f))
* **cocotb:** test_dir da simulacao segue a regra uniforme (pasta do .spf) ([6be8673](https://github.com/nipscernlab/aurora/commit/6be86735c7a35f2cfbbe652f1d222789fc389952))
* **css:** base compartilhada dos botoes, sem tocar em marcacao ([7bf99ff](https://github.com/nipscernlab/aurora/commit/7bf99ff75b88aa790f0da0d24c2273641ae0d4ad))
* **css:** prune dead CSS from the Lit migrations (~685 lines) ([a41985a](https://github.com/nipscernlab/aurora/commit/a41985a5a4828f681693215b8ce61cc873697be5))
* **css:** tokeniza os 46 literais que realmente eram espacamento ([fa103ce](https://github.com/nipscernlab/aurora/commit/fa103ce42a30b6cf68d6954db706ab1f15f7b3a9))
* **editor:** track dirty on the model, not the editor (P1 ckpt 1) ([9adf8cb](https://github.com/nipscernlab/aurora/commit/9adf8cbe3ed38c9bd6f03fa8a916cd2521ee5f99))
* **g9:** spawnTracked como unico ponto de spawn + G8 politica documentada ([14b7d08](https://github.com/nipscernlab/aurora/commit/14b7d08f94ae1e5df502db31345c8d60543031c2))
* **git:** Clone e Projetos mutuamente exclusivos (melhor distribuicao) ([19d17e4](https://github.com/nipscernlab/aurora/commit/19d17e48cc7da971e0970809b9acab8eafd989d3))
* **main:** Wave D — A4 fonte unica de projeto, de-flake e2e, bound de chat ([a9f440b](https://github.com/nipscernlab/aurora/commit/a9f440bf6ca505a6669a7b82a45f6bd28127c89a))
* **modals:** one modal system — relocate the inline opener into modal_system.js ([75d84a8](https://github.com/nipscernlab/aurora/commit/75d84a870ddd562d4bcec859158248aa37d1a58f))
* **terminal:** remove a lista de excedente, que a coluna tornou desnecessaria ([4010f14](https://github.com/nipscernlab/aurora/commit/4010f1414ab2fbcf6feb68a6376baa660e874530))
* **theme:** normalize z-index onto the token scale ([7f9c4aa](https://github.com/nipscernlab/aurora/commit/7f9c4aa899072f929c3a7fd701b6af4d397f5102))
* **theme:** one brand palette; splash/update go offline + on-palette ([9f7cbfd](https://github.com/nipscernlab/aurora/commit/9f7cbfde2dcf6562149a7993114d781a473d71e8))
* **theme:** prune ~40 legacy token aliases (one vocabulary) ([ea319ee](https://github.com/nipscernlab/aurora/commit/ea319eeaad24086a07b9edd1f4f022ee7a3f49cf))
* **theme:** tokenize the chat code-syntax palette ([9432b75](https://github.com/nipscernlab/aurora/commit/9432b75d1bbe13bab859c7aac38dc9418b79f5ba))
* **tokens:** remove --accent-veil, alias identico e sem uso ([a67d435](https://github.com/nipscernlab/aurora/commit/a67d43597015673d5d508e1cfc1721564c47ece9))
* **wave:** achatar a hierarquia volta para o lado de quem a constroi ([485d658](https://github.com/nipscernlab/aurora/commit/485d658976453c0b2fc3de1450205ffffc2b5fb3))
* **wave:** cwd da simulacao e SEMPRE a pasta do projeto (.spf) ([adb8cbf](https://github.com/nipscernlab/aurora/commit/adb8cbfe475b816205b40a3266afb11b7d157b0f))


### Documentation

* §13.C — track the benign Vite non-module warning + the accumulated dead-CSS prune ([e4f9463](https://github.com/nipscernlab/aurora/commit/e4f9463871ae39e8a72e3e2da4c5caa266d9f50f))
* §13.K — note temp-file leak fixed + refinement options (--add-dir / MCP image content) ([fd2c708](https://github.com/nipscernlab/aurora/commit/fd2c708eff399af91f10c7640207ad780c23bd49))
* §14.31 (saga do O9 ao vivo + polish do "Simular") + backlog O9 validado ([e674e3b](https://github.com/nipscernlab/aurora/commit/e674e3b366f3ef65df98baf6ecf96fe17d3a04fc))
* §18 no ESTUDO — estudo completo do sistema de IA (arquitetura real ([538cb47](https://github.com/nipscernlab/aurora/commit/538cb470e176e71f127492dca074dedb0066a797))
* **a2:** §14.43 RESTANTE — handoff Wave 2/3 (classe ai + estado estatico tab) ([1ca1562](https://github.com/nipscernlab/aurora/commit/1ca1562e7543cf49594410f031c0e1a96e371390))
* **a2:** checkpoint Wave 1 (ai_assistant helpers + tab_utils) no BACKLOG ([c071ffa](https://github.com/nipscernlab/aurora/commit/c071ffa2c44e19870335d1c1411077f9dbe06fc8))
* **a2:** fecha tab_manager Wave 2 (save_flow fica na classe por decisao) ([6203ff9](https://github.com/nipscernlab/aurora/commit/6203ff947d2b4ce3483a334aa3e8ddb1888cbed6))
* **a2:** handoff do A2 (compilation_module 2/5) + plano [#3](https://github.com/nipscernlab/aurora/issues/3)-[#5](https://github.com/nipscernlab/aurora/issues/5) pro proximo chat ([3df7c42](https://github.com/nipscernlab/aurora/commit/3df7c4224d513ff428281726ae018eb1270fa8ac))
* **a3:** marca A3 CONCLUIDO 100% (§14.39 + BACKLOG) ([c4a2b68](https://github.com/nipscernlab/aurora/commit/c4a2b68352e35a019b6a9e7fc966cfab98e9503b))
* add section 13 — official remaining-work backlog (the checklist we follow) ([16402bb](https://github.com/nipscernlab/aurora/commit/16402bbaa8a7ae63892859cc4596c2099c7a5efd))
* **ai:** referencia das ferramentas passa a ser gerada do codigo ([70e2e61](https://github.com/nipscernlab/aurora/commit/70e2e61869129dc74060600a48088b3bed55a6a9))
* **architecture:** reescrito em prosa, contratos conferidos no codigo ([62bed4a](https://github.com/nipscernlab/aurora/commit/62bed4af61a13854499f96cb06781115c41c41ca))
* arquiva o estudo do Surfer e corrige a dica que mentia na interface ([297c119](https://github.com/nipscernlab/aurora/commit/297c119ef36de37b43ecedbfec6460b42b346e92))
* **b2:** code-signing runbook (SignPath OSS free) + latest.yml re-hash script ([aaffaa5](https://github.com/nipscernlab/aurora/commit/aaffaa58ec91d054fe901f0d94e0b7833741208d))
* backlog §13.D — memory hygiene (bound retained memory in key surfaces) ([0a555c0](https://github.com/nipscernlab/aurora/commit/0a555c0c638e184246ffa3f64953663483c97450))
* backlog §13.K — allow images + files in the AI chats (multimodal attachments) ([76ace10](https://github.com/nipscernlab/aurora/commit/76ace104ba3717b025b4b9b83279acd2ab65478e))
* backlog §13.K — review/condense the AI prompt injection to save tokens ([2981c2a](https://github.com/nipscernlab/aurora/commit/2981c2a74ffd623831fdd0fbb0ef000532a50744))
* **backlog:** add .spf syntax-highlight + AI-chat follow-up-queue items (§13.K) ([2e69b5a](https://github.com/nipscernlab/aurora/commit/2e69b5a8bd54cc12b566da713f59d4a5a1e2f542))
* **backlog:** atualizacao 17/06 — sessao + main=feature (A2 reabre, B10/G1/B4 feitos) ([4cc8754](https://github.com/nipscernlab/aurora/commit/4cc87546d0e555811961427b6d1d813ac6d9cfa0))
* **backlog:** itens 25/32/33/35 concluidos + disposicao final dos deferidos ([4c6dcf2](https://github.com/nipscernlab/aurora/commit/4c6dcf2c4ee154bc5c3fa4bf2b5021f2aed9e24a))
* **backlog:** marcar Waves A-E concluidas + deferrals com justificativa ([71cba68](https://github.com/nipscernlab/aurora/commit/71cba6803680d80624e3b65b1c52218f626ac417))
* consolida todo o planejamento num TODO.md unico e apaga o resto ([02e4d14](https://github.com/nipscernlab/aurora/commit/02e4d1455ccb67256bef8126422d57dc5411a270))
* consolidate §12 with the session's IA/security/fixes work (done vs left) ([1fbebe3](https://github.com/nipscernlab/aurora/commit/1fbebe33e277dcdd6decae44794e0c2d1110bee8))
* consolidate session "parte 3" + the DESIGN audit (done vs left) ([721c1a8](https://github.com/nipscernlab/aurora/commit/721c1a889f50557ae63564b5c838e79a5fdb2837))
* consolidate the full session into §12 (live checklist) — Lit shell, aurora, modals, quick-wins ([ee6809f](https://github.com/nipscernlab/aurora/commit/ee6809f26c95b450d0f470033079ddc6c434247d))
* corrige a leitura do DESIGN e abre o item 2 em decisoes concretas ([638e67a](https://github.com/nipscernlab/aurora/commit/638e67a42d0b5aa82b39cdb1fc665242569708cb))
* corrige a secao de ondas; eram duas escolhas, nao uma ([5728288](https://github.com/nipscernlab/aurora/commit/5728288c8c48f326726c9af3a28e95b8a4cb788d))
* corrige o SECURITY e o THIRD_PARTY_NOTICES contra o codigo ([0bef4f7](https://github.com/nipscernlab/aurora/commit/0bef4f799dd898743a5ba089f1d01aad7a55a1c0))
* **cpp:** estudo de processadores SAPHO em C++ no pipeline atual ([f3a6b8d](https://github.com/nipscernlab/aurora/commit/f3a6b8dee550979769dc76aa39f85f60e36eafb1))
* **design:** reenquadrado como proposta, depois de conferido contra o CSS ([cf57bec](https://github.com/nipscernlab/aurora/commit/cf57bec174ec8d0c8fa15c0c3c4dcfb554a57434))
* **e2e:** "PRISM open-at-line" NAO e bug (feature verificada) — flake so do CI headless ([4a87449](https://github.com/nipscernlab/aurora/commit/4a87449425bc39c740af50f310f8b52c986249c6))
* encolhe o estudo guarda-chuva de 3420 para 363 linhas ([700fde6](https://github.com/nipscernlab/aurora/commit/700fde6c4c9b24f21a8113d6ee24f41fb0634084))
* estado do Codecov (bloqueado em permissao de org) + CI vermelho no E2E (§14.19) ([2a2f390](https://github.com/nipscernlab/aurora/commit/2a2f390099b35a4c7ac5c9a557a644935a4b59be))
* ESTUDO §18.5 itens 4-5 → FEITO + estado do roadmap + §14.52; ([c8cd3fc](https://github.com/nipscernlab/aurora/commit/c8cd3fcfacc100c7e0e344195dd0469a1beec313))
* estudo do codigo, lido do codigo e nao da documentacao ([33678ed](https://github.com/nipscernlab/aurora/commit/33678edb704467cdcf3a6024de60199fde8e8480))
* **estudo:** §14 — Source Control embutido + polish da IDE (sessao 16-17/06) ([7856b9a](https://github.com/nipscernlab/aurora/commit/7856b9a5757edf25deb6646b8332760e5e23b099))
* **estudo:** §14.1.1 — stage otimista, selecao por shift, changes ao vivo, polish ([b8a3634](https://github.com/nipscernlab/aurora/commit/b8a36340d50a6fa382edba51fda4d89c52aa6c82))
* **estudo:** §14.17 — fechamento da sessao (feito/adiado/bloqueado) + estado do merge para main ([3363217](https://github.com/nipscernlab/aurora/commit/3363217bc5aaefff2759380d594118e96778e5f5))
* **estudo:** registrar trabalho da sessao 15/06 (§4.4, §12, §13) ([696fe4f](https://github.com/nipscernlab/aurora/commit/696fe4f76ea10feb42b7708b5720a4bc1e42d795))
* **estudo:** sessao 16/07 — preview de HTML branco (CSP herdada pelo blob:) ([77b6f93](https://github.com/nipscernlab/aurora/commit/77b6f936250139d8a28cc8c13469728e3d15d1bf))
* **estudo:** troca a nota generica pela conferencia real dos numeros ([3dc781f](https://github.com/nipscernlab/aurora/commit/3dc781ff258493860b6ccca8704b8a7dbd3bd1da))
* funde ROADMAP no PENDENCIAS e RELEASE no CONTRIBUTING ([ca58f7c](https://github.com/nipscernlab/aurora/commit/ca58f7c0db9344149341aafbcf6be2cd759f7925))
* fusão dos estudos num doc único — ESTUDO_COMPLETO_AURORA.md ganha ([711dfd4](https://github.com/nipscernlab/aurora/commit/711dfd4a953dee9374b28e662135e2a4c55f9764))
* **licenca:** o anexo dizia que o YANC e nosso e que ja assinamos; nem um nem outro ([80c174f](https://github.com/nipscernlab/aurora/commit/80c174fe60fedb57000eecd273ee3cc9123bec70))
* **licenca:** o repositorio dizia MIT em quatro lugares depois da troca ([63a6bd5](https://github.com/nipscernlab/aurora/commit/63a6bd53b32537949f5a628bfabdcd948a8028e8))
* **licenciamento:** a analise que falta para decidir, e o e-mail pronto para mandar ([10c1c6c](https://github.com/nipscernlab/aurora/commit/10c1c6cd61d185ab9afbaa15eebb0c4ba1570fa5))
* **license:** AURORA e SAPHO passam para a Licenca NIPS-CERN 1.1 ([58529a6](https://github.com/nipscernlab/aurora/commit/58529a621cfc74abf644a817ff5225e02a7e2fb9))
* link README to NIPS-CERN and UFJF institutional context ([bb63b37](https://github.com/nipscernlab/aurora/commit/bb63b37bcb492b63535892319d6e8d25c1804752))
* **manual:** manual do usuario SAPHO completo em LaTeX (livro, 98 pgs) ([92eeb33](https://github.com/nipscernlab/aurora/commit/92eeb334a5df7b9380d0dc238be723c2e0ee7c95))
* **manual:** redesenho completo do manual SAPHO (livro classico, 109 pgs) ([c3c53d6](https://github.com/nipscernlab/aurora/commit/c3c53d687c75466f227ad8bae572a547842595da))
* mark A6 done (exec-command already removed) + flag A8 as risky ([c43b33f](https://github.com/nipscernlab/aurora/commit/c43b33fd6f58d409a233b51ff51211f65cc44f7d))
* **o1:** marca O1 como due-diligence-feita/bloqueado-no-dev no BACKLOG ([911d7c1](https://github.com/nipscernlab/aurora/commit/911d7c1b4b5d3b169709688aa455d04a3c273b0e))
* **o1:** registra due diligence do embed Surfer (WASM/WCP bloqueados no dev) §16 ([e10ee13](https://github.com/nipscernlab/aurora/commit/e10ee137d1db494713df6e989c2849036786805a))
* PENDENCIAS.md — o backlog honesto do que ainda nao foi feito ([64eecc3](https://github.com/nipscernlab/aurora/commit/64eecc3d023409fece84119a18d8a89b346c565f))
* **pendencias:** a fonte Norse vai dentro do instalador, e isso e distribuicao ([9e71473](https://github.com/nipscernlab/aurora/commit/9e71473030524e536d007e2daebe1575e884038a))
* **pendencias:** item 2 registra a interface feita e o que sobrou ([88f87fe](https://github.com/nipscernlab/aurora/commit/88f87fef70e9355133e293c373ef4bc6e27fc6a9))
* **pendencias:** item 7 vira o que da e o que nao da para dividir ([a574454](https://github.com/nipscernlab/aurora/commit/a574454caa4663aecebbd3a5d42760c0806dde57))
* **pendencias:** item 8 vira "AI SDK na geracao 7, sem prova ao vivo" ([e642e3d](https://github.com/nipscernlab/aurora/commit/e642e3d5f4901fa9c066c90702e209774228afbb))
* **pendencias:** o plano, em duas trilhas ([a356766](https://github.com/nipscernlab/aurora/commit/a356766ba9b2e0b8d589cb2ea98130e48e82836a))
* **pendencias:** registra a cacada de bugs e o que ela descartou ([44e4def](https://github.com/nipscernlab/aurora/commit/44e4def7f2b34d56445408369fc0fdd35e434a53))
* **pendencias:** registra o split dos god files como item 7 ([270390c](https://github.com/nipscernlab/aurora/commit/270390cee0364b090e68c7a00348ea5ddd3bc44f))
* **pendencias:** registra os oito pedidos de 08/08/2026 ([3124367](https://github.com/nipscernlab/aurora/commit/312436777db70b825219e93c93d12e448649fc2f))
* **pendencias:** registra que a lista de abas nao dispara na maquina do usuario ([325a7aa](https://github.com/nipscernlab/aurora/commit/325a7aab5eb6aed26007cbe440b818923cdbf792))
* **pendencias:** sai o que foi feito, entra o que ficou pela metade ([8ac10d4](https://github.com/nipscernlab/aurora/commit/8ac10d4c08e811f01bb2c15b1881f4de10f64c4b))
* **plano:** instantaneo da sessao de 10/08 para retomar de outra maquina ([0de4109](https://github.com/nipscernlab/aurora/commit/0de4109d40af10b1b3aa13f7f94521647f2ab57f))
* **prism:** funde STANDARD no README das skins ([b3186c9](https://github.com/nipscernlab/aurora/commit/b3186c92fa02578965dd5938b079cd75da7989e2))
* **python:** documento LaTeX da infra de Python da AURORA ([48bdbf2](https://github.com/nipscernlab/aurora/commit/48bdbf2a568cceafc5508ebb79ada4dacdf6fb2f))
* **readme:** o hero deixa de ser promessa e passa a sair do aplicativo ([30047d5](https://github.com/nipscernlab/aurora/commit/30047d53d4623fad7c44e1d0d3a2e81083f81993))
* **readme:** reescrito a partir do codigo, com os fatos conferidos ([6914bb2](https://github.com/nipscernlab/aurora/commit/6914bb2afb8a3e39681085743bb6d55d99a766eb))
* referência técnica do núcleo SAPHO (compacta ≤20p + estudo extenso) ([947c1b9](https://github.com/nipscernlab/aurora/commit/947c1b9668b3a403a3ddd7a15307cddddb295bba))
* register the Surfer-vs-GTKWave feasibility study (O1) ([514a48d](https://github.com/nipscernlab/aurora/commit/514a48d369afe2af7587232192e0ee307f174e45))
* registra a sessao de preparacao do laboratorio e os invariantes achados ([426c15f](https://github.com/nipscernlab/aurora/commit/426c15f2353c00b026c61c8e0f70c386053407d0))
* remove obsolete interlude + git-history-rewrite plans ([931a9ea](https://github.com/nipscernlab/aurora/commit/931a9ea800f67785f05ad1e1a3d6ef5a17c355eb))
* remove os dois .tex de infraestrutura, apagados pelo autor ([726cb8c](https://github.com/nipscernlab/aurora/commit/726cb8cf00cd523dc75016b5a3bfc25cbb16eb7b))
* remove os emojis dos documentos sem perder o que eles classificavam ([27055ac](https://github.com/nipscernlab/aurora/commit/27055aca48bb18d31ff1b9231d96cd4eda4851ca))
* **signing:** corrige a premissa de EV/SmartScreen e registra os termos da Foundation ([946566c](https://github.com/nipscernlab/aurora/commit/946566ce73e3ea7316a73ca7e935edbae6e2a418))
* **signing:** leitura dos Termos de Servico e as duas decisoes que ela muda ([a30340c](https://github.com/nipscernlab/aurora/commit/a30340cac55e75c5d0443c68ac941d581bddae70))
* snapshot 18/06 do backlog (feito checado + aberto ordenado) + §14.20 (status bar = medio) ([caedb6f](https://github.com/nipscernlab/aurora/commit/caedb6f3e734c8fc4697c641b17020fa09af2ee9))
* **surfer:** §12 — ponto de retomada (estado, v2 próximo, descobertas) ([92f208c](https://github.com/nipscernlab/aurora/commit/92f208cf6be5e6e51a9dd7596759d1c4e2261522))
* **surfer:** §13 — translators, complexo, labels por-proc, dividers, grupos ([d075bde](https://github.com/nipscernlab/aurora/commit/d075bde916cdd67a83913b3765addf24c06d82fe))
* **surfer:** §14 — trio de quick-wins (auto-reload, folding, pre-checks) ([21f3958](https://github.com/nipscernlab/aurora/commit/21f39586f78809e952459ef2682cbca9fdae8c95))
* **surfer:** §15 lote autonomo (toggle, analog, bundle, e2e complexo) + CHANGELOG ([a0070d2](https://github.com/nipscernlab/aurora/commit/a0070d20a13bd9bea38a20aceaf714ac7376f4bd))
* **surfer:** corrigir registro do auto-reload (nao funciona no Windows) + uma-janela + label ([7d20f52](https://github.com/nipscernlab/aurora/commit/7d20f5251a06aa99a9bcca5fb1d9450840e7f1c8))
* **surfer:** documento LaTeX da infra do Surfer/Surfer-Aurora ([18fc24f](https://github.com/nipscernlab/aurora/commit/18fc24f5127667cff921985e12e382270feee97e))
* **surfer:** NIPS-CERN, sem overflow, blocos indivisiveis, sem sumario ([4be729e](https://github.com/nipscernlab/aurora/commit/4be729ece644124359fb69372129b1d611e2d94a))
* **surfer:** registrar batch de robustez (anti-staleness, namespacing, escrita atomica) ([558931a](https://github.com/nipscernlab/aurora/commit/558931a30d09b46a3e51c3d037882667dc15a462))
* **todo:** add user-facing third-party-software disclosure to the backlog (§13 J) ([fbd3d4a](https://github.com/nipscernlab/aurora/commit/fbd3d4addeaf48c9d8c84b4290e405300fe89ed6))
* **todo:** o backlog vira um TODO.md unico na raiz, ordenado pelo deploy ([bba09c6](https://github.com/nipscernlab/aurora/commit/bba09c6bdeb7b4bf516f12eb1b464de21c451941))
* update §12 checklist — perf/visual tracks done, P1 reverted ([d85d1c1](https://github.com/nipscernlab/aurora/commit/d85d1c16d2cb8b0eb7e63b6fd7ece6be27795733))


### Build

* **ai:** auto-sync do manifesto de CLIs com package.json + lock ([cee4922](https://github.com/nipscernlab/aurora/commit/cee4922189e746b83e0198fd998ed50646f18371))
* alinha a versao de Node entre engines, CI e README ([3193c5a](https://github.com/nipscernlab/aurora/commit/3193c5a56c66a0baad228138319d5bd7ef58411e))
* **deps-dev:** bump @commitlint/cli from 19.8.1 to 21.2.1 ([#47](https://github.com/nipscernlab/aurora/issues/47)) ([67d7255](https://github.com/nipscernlab/aurora/commit/67d72553f91c136f43b54eaff5d9b616352d21f0))
* **deps-dev:** bump @commitlint/config-conventional ([#59](https://github.com/nipscernlab/aurora/issues/59)) ([a5e18ed](https://github.com/nipscernlab/aurora/commit/a5e18edcd9b42dd36c536c8787c7648a5ca5ebc0))
* **deps-dev:** bump @eslint/js from 9.39.1 to 10.0.1 ([#5](https://github.com/nipscernlab/aurora/issues/5)) ([9d18f6b](https://github.com/nipscernlab/aurora/commit/9d18f6b27b5cd8f49922db8b519f1d306070cf21))
* **deps-dev:** bump @types/node from 25.9.3 to 26.1.2 ([#48](https://github.com/nipscernlab/aurora/issues/48)) ([69b5e90](https://github.com/nipscernlab/aurora/commit/69b5e90879746f900a91ffd6239e4297df27cbaf))
* **deps-dev:** bump electron from 39.8.10 to 43.3.0 ([#42](https://github.com/nipscernlab/aurora/issues/42)) ([ec89255](https://github.com/nipscernlab/aurora/commit/ec892555ebac69b891f58762baafdfbe58e27266))
* **deps-dev:** bump eslint from 9.39.1 to 10.8.0 ([#46](https://github.com/nipscernlab/aurora/issues/46)) ([d9aa6c2](https://github.com/nipscernlab/aurora/commit/d9aa6c2166ea3589d4e99cb5c66d3735cbdeb302))
* **deps-dev:** bump globals from 16.5.0 to 17.9.0 ([#44](https://github.com/nipscernlab/aurora/issues/44)) ([a84a5bb](https://github.com/nipscernlab/aurora/commit/a84a5bb05321b959576b8c26cdf02679c5ee0412))
* **deps-dev:** bump happy-dom in the dev-dependencies group ([#21](https://github.com/nipscernlab/aurora/issues/21)) ([cc07f29](https://github.com/nipscernlab/aurora/commit/cc07f29b53ba63002a4c66b8ff8c218db9dd4861))
* **deps-dev:** bump lint-staged from 16.4.0 to 17.3.0 ([#57](https://github.com/nipscernlab/aurora/issues/57)) ([84cf4c2](https://github.com/nipscernlab/aurora/commit/84cf4c2c9b0073968101805c0b55f6041c2e7363))
* **deps-dev:** bump the dev-dependencies group across 1 directory with 6 updates ([#18](https://github.com/nipscernlab/aurora/issues/18)) ([01568af](https://github.com/nipscernlab/aurora/commit/01568affa7a3869bf719ac6353ea33ce1312fd9d))
* **deps-dev:** bump the dev-dependencies group with 3 updates ([#30](https://github.com/nipscernlab/aurora/issues/30)) ([a4c3e54](https://github.com/nipscernlab/aurora/commit/a4c3e546c6816d6785eb74c7f77242d34ed4b37e))
* **deps-dev:** bump the dev-dependencies group with 5 updates ([#65](https://github.com/nipscernlab/aurora/issues/65)) ([e8cb476](https://github.com/nipscernlab/aurora/commit/e8cb476e0a28da2eaae220264a0f936022130a01))
* **deps-dev:** bump the dev-dependencies group with 6 updates ([#39](https://github.com/nipscernlab/aurora/issues/39)) ([ff39600](https://github.com/nipscernlab/aurora/commit/ff39600c796b14cb688091c09423d8dc97598757))
* **deps-dev:** bump typescript from 6.0.3 to 7.0.2 ([#61](https://github.com/nipscernlab/aurora/issues/61)) ([f111d2c](https://github.com/nipscernlab/aurora/commit/f111d2cc678b8184342158aada6cce20f925e02b))
* **deps:** agrupa a familia do AI SDK e registra a migracao para a geracao 7 ([350ab5d](https://github.com/nipscernlab/aurora/commit/350ab5dfb8e1a86ad24f455892f83ddc42da7503))
* **deps:** bloqueia a major do jQuery e registra a decisao sobre release ([c253b45](https://github.com/nipscernlab/aurora/commit/c253b45260f97ce1303da920d83d95a0b3c12264))
* **deps:** bump @ai-sdk/anthropic from 3.0.78 to 3.0.85 ([#24](https://github.com/nipscernlab/aurora/issues/24)) ([c4ea22a](https://github.com/nipscernlab/aurora/commit/c4ea22a13ac6409d4a162eaaba14c30707bf4fa6))
* **deps:** bump @ai-sdk/anthropic from 3.0.85 to 3.0.86 ([#31](https://github.com/nipscernlab/aurora/issues/31)) ([7481340](https://github.com/nipscernlab/aurora/commit/748134056614be3017ff6f53980db5797fc0ea3e))
* **deps:** bump @ai-sdk/deepseek from 2.0.35 to 2.0.39 ([#25](https://github.com/nipscernlab/aurora/issues/25)) ([c8c3ab5](https://github.com/nipscernlab/aurora/commit/c8c3ab540a8d6a0a21ce5adb685b9a698f4c96ee))
* **deps:** bump @ai-sdk/google from 3.0.75 to 3.0.83 ([#23](https://github.com/nipscernlab/aurora/issues/23)) ([6b78771](https://github.com/nipscernlab/aurora/commit/6b7877149ba2fc953f9c6583fd5de10b7030cb85))
* **deps:** bump @anthropic-ai/claude-agent-sdk from 0.3.210 to 0.3.222 ([#60](https://github.com/nipscernlab/aurora/issues/60)) ([7e38c32](https://github.com/nipscernlab/aurora/commit/7e38c3212842afcc2e4d066321b562a0344ee8d0))
* **deps:** bump @anthropic-ai/claude-agent-sdk from 0.3.222 to 0.3.226 ([#70](https://github.com/nipscernlab/aurora/issues/70)) ([ec425e6](https://github.com/nipscernlab/aurora/commit/ec425e62c659204f714c683494a70380ab20e1e2))
* **deps:** bump @anthropic-ai/claude-code from 2.1.202 to 2.1.222 ([#49](https://github.com/nipscernlab/aurora/issues/49)) ([ec766d0](https://github.com/nipscernlab/aurora/commit/ec766d0bccf60262d414c056c11447289f5c54a5))
* **deps:** bump @lydell/node-pty from 1.2.0-beta.12 to 1.2.0-beta.14 ([#62](https://github.com/nipscernlab/aurora/issues/62)) ([7a85587](https://github.com/nipscernlab/aurora/commit/7a855876f0fe92cf85ff4d509efad536e3bc4d84))
* **deps:** bump @lydell/node-pty from 1.2.0-beta.14 to 1.2.0-beta.15 ([#72](https://github.com/nipscernlab/aurora/issues/72)) ([85a88ca](https://github.com/nipscernlab/aurora/commit/85a88cafb5204647cf2652ff9ec0d340ad54338e))
* **deps:** bump @openai/codex-sdk from 0.144.3 to 0.146.0 ([#45](https://github.com/nipscernlab/aurora/issues/45)) ([87cfc95](https://github.com/nipscernlab/aurora/commit/87cfc9508f896e9c6dd4863a04e505462c1a8ee1))
* **deps:** bump @openai/codex-sdk from 0.146.0 to 0.147.0 ([#68](https://github.com/nipscernlab/aurora/issues/68)) ([d959e09](https://github.com/nipscernlab/aurora/commit/d959e097565499df169c07247b92182c1ee0ace8))
* **deps:** bump @phosphor-icons/web from 2.1.1 to 2.1.2 ([#22](https://github.com/nipscernlab/aurora/issues/22)) ([d04d26c](https://github.com/nipscernlab/aurora/commit/d04d26ccd407f5253d5f36c7794f15401cced7f4))
* **deps:** bump actions/checkout from 5 to 7 ([#37](https://github.com/nipscernlab/aurora/issues/37)) ([f2c3d68](https://github.com/nipscernlab/aurora/commit/f2c3d683de6963313edba9f08c7a497c823f32b3))
* **deps:** bump actions/setup-node from 5 to 7 ([#38](https://github.com/nipscernlab/aurora/issues/38)) ([692aa64](https://github.com/nipscernlab/aurora/commit/692aa645fddef5eecc87e81ca0429c82a03f41ae))
* **deps:** bump chokidar from 4.0.3 to 5.0.0 ([#14](https://github.com/nipscernlab/aurora/issues/14)) ([a6445c9](https://github.com/nipscernlab/aurora/commit/a6445c9b3da15db99e8cef978bea8e5bd46a1568))
* **deps:** bump codecov/codecov-action from 5 to 7 ([#51](https://github.com/nipscernlab/aurora/issues/51)) ([5897873](https://github.com/nipscernlab/aurora/commit/5897873c9daf4b0af9702a9cebe221de64817109))
* **deps:** bump electron-log from 5.4.3 to 5.4.4 ([#56](https://github.com/nipscernlab/aurora/issues/56)) ([e735182](https://github.com/nipscernlab/aurora/commit/e7351827a41474c8afed2262c22afefec247b22c))
* **deps:** bump electron-updater from 6.6.2 to 6.8.9 ([#26](https://github.com/nipscernlab/aurora/issues/26)) ([99f9369](https://github.com/nipscernlab/aurora/commit/99f9369ac8959b5cda20a5ca92382b946b7bd7c9))
* **deps:** bump fs-extra from 11.3.2 to 11.4.0 ([#15](https://github.com/nipscernlab/aurora/issues/15)) ([bc9d59a](https://github.com/nipscernlab/aurora/commit/bc9d59adc391ca52d3f986365a7e60f31ccfe000))
* **deps:** bump github/codeql-action from 3 to 4 ([#19](https://github.com/nipscernlab/aurora/issues/19)) ([659dd38](https://github.com/nipscernlab/aurora/commit/659dd38944a3db60ec8977f2e65474ad7c5fbc6f))
* **deps:** bump googleapis/release-please-action from 4 to 5 ([#13](https://github.com/nipscernlab/aurora/issues/13)) ([70a76e6](https://github.com/nipscernlab/aurora/commit/70a76e6216783dd05664889bb1c4af21e4cc1b43))
* **deps:** bump katex from 0.17.0 to 0.18.1 ([#58](https://github.com/nipscernlab/aurora/issues/58)) ([d5e29fb](https://github.com/nipscernlab/aurora/commit/d5e29fb6829c346cdfef3caafd713a3164ad63bb))
* **deps:** bump katex from 0.18.1 to 0.18.2 ([#67](https://github.com/nipscernlab/aurora/issues/67)) ([e5f5a46](https://github.com/nipscernlab/aurora/commit/e5f5a46244d7538d8a6c953f387e9df5d85ff3a3))
* **deps:** bump material-icon-theme from 5.36.1 to 5.37.0 ([#40](https://github.com/nipscernlab/aurora/issues/40)) ([85515ed](https://github.com/nipscernlab/aurora/commit/85515ed0fdec710d69c1ec30549e4d7a3b36f3df))
* **deps:** bump the ai-sdk group across 1 directory with 6 updates ([#52](https://github.com/nipscernlab/aurora/issues/52)) ([2d8d90d](https://github.com/nipscernlab/aurora/commit/2d8d90d9fb82aadd339e2a90d255dbb93add7603))
* **deps:** bump the ai-sdk group across 1 directory with 6 updates ([#66](https://github.com/nipscernlab/aurora/issues/66)) ([f5fc3a3](https://github.com/nipscernlab/aurora/commit/f5fc3a3f9b661f0cf7473b070af0a5a6ddcb78ce))
* **deps:** bump web-tree-sitter from 0.26.9 to 0.26.11 ([#53](https://github.com/nipscernlab/aurora/issues/53)) ([a42a72c](https://github.com/nipscernlab/aurora/commit/a42a72c58986f4460600e806a97c923b324d3585))
* **deps:** ignora monaco-editor no Dependabot antes de ligar o auto-merge ([d5359de](https://github.com/nipscernlab/aurora/commit/d5359de7ed17a324648b8344375a94cb200097da))
* **deps:** sobe @openai/codex para 0.146.0 com o manifesto junto ([fd50f8a](https://github.com/nipscernlab/aurora/commit/fd50f8a734b82593674db9294b772412f779a0f3))
* **icons:** remove exclusões mortas do [@fortawesome](https://github.com/fortawesome) (F1) + F2 fonts local verificado ([ea64df9](https://github.com/nipscernlab/aurora/commit/ea64df916c15c59dd33cd0b3318d33d7a0ee5c98))
* **identity:** aplicativo instalado passa a se chamar SAPHO; alinha o appId ([c6dfaef](https://github.com/nipscernlab/aurora/commit/c6dfaefc7d977c4e964e06ed536145b4f4ee7ca0))
* limpa o log do build, consertando o que era real e calando o que e desenho ([9f7f15a](https://github.com/nipscernlab/aurora/commit/9f7f15a12c093253bcdd23f9fe41656a44172156))
* **lsp:** sobe o Verible e o slang-server, que o guarda achou atrasados ([50929f5](https://github.com/nipscernlab/aurora/commit/50929f5a41a604f40e5b222a87fbf1613a6fb8c3))
* **release:** a versao e a data do CITATION saem da mao e passam a ser do release-please ([e4d0886](https://github.com/nipscernlab/aurora/commit/e4d08865b36239f5b4d9857ba393a46bcf7d5a8a))
* **surfer:** bundlar surfer.exe v0.7.0 no instalador (download no bootstrap) ([ab87463](https://github.com/nipscernlab/aurora/commit/ab874637c6b8568a0154e3a2b97849169f159770))
* **surfer:** o fork estava cinco tags a frente do que a AURORA instalava ([3519b27](https://github.com/nipscernlab/aurora/commit/3519b270460cbcecae42a55ae5295275b7ead8c6))
* **vite:** adopt Vite as the renderer bundler (A1, renderer-only, flag-gated) ([de3315f](https://github.com/nipscernlab/aurora/commit/de3315f6aaf277feb94ebcf69f4f84a1979e809a))
* **vite:** flip default to bundled renderer + all windows through Vite (A1 Stage 3+4) ([348f694](https://github.com/nipscernlab/aurora/commit/348f6949ebc5be157ba7c3926588070be3b0b82e))

## [Unreleased]

### Added
- LICENSE (MIT) with a third-party attributions section.
- Refreshed README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- `.editorconfig`, `.gitattributes`, `.github/` workflows and templates.
- `js/editor/shared_models.js`: reference-counted Monaco model registry
  so split panes of the same file edit, undo, and save in sync.
- `SplitEditorManager.getFocusedFile()` and `TabManager.getEditingFilePath()`
  so Ctrl+S saves whichever pane has focus.
- `aurora-editor-focused` event: cursor in any editor now activates the
  corresponding tab automatically.
- `RELEASE.md`: bootstrap process for end users; toolchain binaries no
  longer live in the source tree.
- Surfer waveform viewer — curated `.surf.ron` layout now decodes the
  Assembly (`valr2`) and source-line (`linetabs`) instruction tracks via
  Surfer mapping translators (built from the YANC `trad_opcode.txt` /
  `trad_cmm.txt`), and decodes complex numbers (`comp_me3_*` /
  `comp_arr_me3_*`) through a `comp2gtkw.exe` pre-pass. Instruction tracks
  are always shown whenever a processor is present.
- Surfer layout — per-processor labels on the Assembly/C+- tracks (e.g.
  `Assembly (cnn_features)`), red-coloured section dividers (kept italic),
  and a real collapsible `Group` per processor so multi-processor designs
  fold cleanly. Per-processor instruction labels also applied to GTKWave.
- Surfer quick-wins — each section (I/O, Instructions, Variables, Flags,
  arrays, Stack/ULA) is now a nested collapsible group (arrays/Flags closed
  by default); the complex-decode path pre-checks `comp2gtkw.exe`/`fst2vcd.exe`
  and warns once in the terminal instead of degrading to raw binary silently;
  re-simulating reuses a single Surfer window (the previous one is closed
  before the new launch) instead of stacking windows; and the launch terminal
  messages now say "Surfer" instead of "GTKWave". (Surfer's own file-watch
  auto-reload does not fire on Windows v0.7.0, so it is not used.)
- Surfer is now bundled in the installer — `download-surfer.js` fetches
  `surfer.exe` v0.7.0 during bootstrap (the `extraResources` step ships it),
  so the Surfer viewer works out of the box instead of falling back to GTKWave.
  Listed under EUPL-1.2 in the third-party attributions.
- Surfer: a "keep windows open to compare runs" toggle in the Wave Configuration
  modal — off by default (one window, the previous is closed on each launch),
  on to keep multiple Surfer windows for side-by-side comparison.
- Surfer: automatic latency markers — the first `req_in_sim_*` (input arrives)
  and first `out_en_sim_*` (output ready) get markers, and the cursor/delta
  window opens, so input→output latency reads off directly. A bounded pre-pass
  streams `fst2vcd` and stops as soon as both events are found (gated on the
  project actually having I/O signals).
- Surfer: clk/rst/itr render at half height so data signals stand out.
  (Float variables stay as readable numbers — an analog curve was tried and
  reverted, since a float constant would just be a useless flat line.)
- Surfer mapping robustness — translator files are now namespaced per project
  (FNV-1a tag of the project path) so two open projects with the same testbench
  top no longer overwrite each other in the shared global mappings dir; written
  atomically (temp + rename) so the viewer never reads a half-written file; and
  the renderer warns when the decode tables are newer than the dump (recompiled
  without re-simulating → the Assembly/source decode would be stale).

### Changed
- All file trees (standard, hierarchy, Verilog) now share a single
  typography — same row height, font size, weight, and colour.
- Project loading now seeds `window.availableProcessors` from the SPF
  payload so processor folders get their per-processor colour on the
  first paint, not after the user opens Settings.
- Per-processor colour assignment is positional (16 distinct slots,
  wrapping after 16) instead of hash-based.
- Backups produce a real `.zip` via PowerShell `Compress-Archive` and
  always clean up the staging folder, even on failure.
- Verilog-only GTKWave run now stages `fix.vcd` and uses
  `gtk_almost_proj.tcl` so the fix tab opens like in the other modes.
- Pen (`vericomp`) and square-wave (`wavecomp`) icons redrawn in toolbar
  and terminal tabs.

### Fixed
- Collapse-All actually collapses (the previous handler only refreshed
  because `FileTreeState` wasn't exported).
- "No project open" label no longer sticks after a successful auto-load
  with sparse `.spf` metadata.
