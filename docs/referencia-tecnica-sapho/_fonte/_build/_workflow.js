export const meta = {
  name: 'sapho-referencia-tecnica',
  description: 'Estuda o codigo-fonte do nucleo SAPHO (AURORA+YANC+toolchain) e escreve uma referencia tecnica completa em LaTeX (PT-BR), um capitulo por agente, com revisao tecnica/LaTeX por capitulo.',
  phases: [
    { title: 'Capitulos', detail: 'Estudo de codigo + escrita LaTeX de cada capitulo, com revisao' },
    { title: 'Sintese', detail: 'Pipeline ponta-a-ponta (le os capitulos ja escritos)' },
  ],
}

// ---------------------------------------------------------------------
// CONTEXTO COMPARTILHADO (entra em TODO agente)
// ---------------------------------------------------------------------
const SHARED = `
== PROJETO ==
Voce esta documentando o NUCLEO da plataforma SAPHO ("Scalable-Architecture Processor for Hardware
Optimization"), desenvolvida pelo laboratorio NIPSCERN na UFJF (Universidade Federal de Juiz de
Fora, Brasil). SAPHO = a suite que une AURORA + YANC + um toolchain bundle.

- AURORA: a IDE desktop (Electron + Monaco) onde o usuario projeta soft-processors. REPO ATUAL/VIVO.
- YANC ("Yet Another Compiler"): os compiladores que traduzem C+- / C++ ate Verilog sintetizavel,
  imagens de memoria (.mif) e testbench.
- toolchain bundle (repo aurora-toolchain): o snapshot portatil msys/mingw64 com iverilog, verilator,
  yosys, gcc/g++, python+cocotb etc. que a AURORA baixa e empacota.
- PRISM = visualizador de RTL (Yosys -> netlistsvg). Aurora Intelligence = subsistema de IA.

== LOCALIZACAO DOS REPOS (no disco) ==
- aurora (IDE):              C:/Users/chrys/Documents/GitHub/aurora
- yanc (compiladores):       C:/Users/chrys/Documents/GitHub/yanc
- gtkwave-nipscern (fork):   C:/Users/chrys/Documents/GitHub/gtkwave-nipscern
- aurora-toolchain:          C:/Users/chrys/Documents/GitHub/_sapho_study/aurora-toolchain
- netlistsvg-aurora (fork):  C:/Users/chrys/Documents/GitHub/_sapho_study/netlistsvg-aurora
- sapho (so README):         C:/Users/chrys/Documents/GitHub/_sapho_study/sapho
- nipscernweb (site do lab): C:/Users/chrys/Documents/GitHub/nipscernweb
Use a ferramenta Read com caminho absoluto (funciona fora do cwd). Use Grep/Glob para localizar.
Para git/history use Bash (Git Bash; caminhos estilo /c/Users/chrys/...). Pode usar 'git -C <path>'.

== REGRA DE OURO: A FONTE DA VERDADE E O CODIGO-FONTE ==
NAO confie na documentacao existente. Os arquivos .md (README.md, ARCHITECTURE.md, CHANGELOG.md,
docs/ESTUDO_COMPLETO_AURORA.md, docs/aurora-intelligence-tools.md, docs/surfer-feasibility.md,
docs/DESIGN.md, etc.) podem estar DESATUALIZADOS, ASPIRACIONAIS ou ERRADOS. Trate-os apenas como
PISTAS para localizar onde as coisas estao. VERIFIQUE cada afirmacao lendo o codigo real
(.js, .ts, .v, .c, .l, .y, .h, .bat, .sh, .json, configs). Onde doc e codigo divergirem, O CODIGO
VENCE. Nao copie prosa de documentacao. So afirme o que voce confirmou abrindo o arquivo. Cite os
nomes de arquivo/simbolo que voce realmente abriu.

== CORRECOES IMPORTANTES (do dono do projeto) ==
- POLARIS esta DESCONTINUADO (projeto morto). NAO documente POLARIS. No maximo UMA frase de contexto
  historico se for inevitavel.
- Aurora Intelligence esta COMPLETAMENTE IMPLEMENTADO. Porem o provider e os modelos PROPRIOS do
  laboratorio ainda NAO foram treinados (e item de roadmap). Declare esse status com precisao.

== IDIOMA E TOM ==
- Escreva em PORTUGUES DO BRASIL, registro tecnico, claro e preciso.
- TOM DESCRITIVO/NEUTRO: descreva o que existe e o que faz. NAO inclua analise de vulnerabilidades,
  achados de seguranca, reclamacoes de performance, "divida tecnica", criticas ou recomendacoes de
  refatoracao. E uma referencia tecnica do que o sistema E e FAZ.
- Seja EXAUSTIVO e bem estruturado: este e um documento de referencia definitivo. Prefira muitas
  subsecoes, tabelas e exemplos a paragrafos vagos.

== CONVENCOES LaTeX (obrigatorias para compilar) ==
O preambulo ja existe em main.tex. Voce escreve APENAS o corpo do capitulo no arquivo .tex indicado.
- O arquivo JA EXISTE como placeholder. Faca Read nele primeiro e depois SOBRESCREVA por completo com
  Write (conteudo novo inteiro).
- O arquivo deve comecar com:  % !TEX root = ../main.tex   (linha 1)
  depois  \\chapter{<TITULO DADO>}  e  \\label{cap:<ID DADO>}  e entao o conteudo.
- NAO emita \\documentclass, \\usepackage, \\begin{document} nem preambulo. Somente corpo.
- Estruture com \\section, \\subsection, \\subsubsection.
- Pacotes/recursos disponiveis: booktabs, tabularx (colunas Y e Z ja definidas:
  \\begin{tabularx}{\\linewidth}{Y Y}...), longtable (para tabelas longas), enumitem
  (itemize/enumerate/description), listings, hyperref (\\url, \\href), csquotes (\\enquote).
- CODIGO: use o ambiente lstlisting. Verilog -> [language=Verilog]; C -> [language=C];
  JS/TS -> [language=Java] (aproximado) ou sem language; shell -> [language=bash]; C+- -> [style=cmm].
  Ex.: \\begin{lstlisting}[language=Verilog] ... \\end{lstlisting}. Mantenha o conteudo de codigo em
  ASCII quando possivel. Diagramas de fluxo: use um lstlisting ASCII (NAO use TikZ, NAO use imagens).
- CODIGO/IDENTIFICADORES/CAMINHOS INLINE: use \\lstinline|...| (delimitador barra vertical) para
  qualquer token com caractere especial, ou \\path{...} para caminhos de arquivo, ou \\texttt{...}.
  Macros prontas: \\cmm (renderiza "C+-"), \\repo{nome} (-> nipscernlab/nome), \\file{caminho},
  \\tool{NOME}, \\code{...}.
- NUNCA deixe um caractere especial cru em texto normal. Escape: \\_  \\%  \\&  \\#  \\$
  \\textbackslash{}  \\textasciitilde{}  \\textasciicircum{}. (Ou embrulhe em \\lstinline/\\path/\\texttt.)
  Atencao especial a sublinhados em nomes (ex.: ai\\_assistant\\_manager.js) e ao caractere & em tabelas.
- Tabelas: \\begin{tabularx}{\\linewidth}{Y Y Y} ... \\toprule ... \\midrule ... \\bottomrule
  \\end{tabularx}. Para tabelas com muitas linhas use longtable. Em celulas, escape & como \\& e _
  como \\_ (ou use \\lstinline).
- Notas/destaques: use o ambiente {nota}...{} ja definido, ou {quote}.
- Referencias cruzadas: \\label/\\ref/\\autoref permitidos. NAO use \\cite (nao ha bib). Para recursos
  externos use \\url{...} ou \\href{url}{texto}.
- NAO ha LaTeX instalado para compilar aqui, entao seja meticuloso: chaves balanceadas, todo
  \\begin{X} com \\end{X}, todo lstlisting fechado, nenhum caractere especial cru.

== EVITE SOBREPOSICAO ==
Cada capitulo tem um escopo. Fique no seu escopo; quando tocar um assunto de outro capitulo, mencione
de passagem e use \\autoref{cap:<id>} em vez de re-documentar.
`.trim()

// ---------------------------------------------------------------------
// CAPITULOS
// ---------------------------------------------------------------------
const OUT = 'C:/Users/chrys/Documents/GitHub/aurora/docs/referencia-tecnica-sapho/capitulos'

const CHAPTERS = [
  {
    id: '01-contexto-visao-geral', file: '01-contexto-visao-geral.tex',
    title: 'Contexto e visão geral',
    scope: `Apresente: (a) o laboratorio NIPSCERN e a UFJF (use o repo nipscernweb e o arquivo
CITATION.cff do aurora como fontes; WebSearch APENAS para enriquecer contexto sobre NIPSCERN/UFJF e
sobre soft-processors em FPGA/arquitetura de computadores — inclua so fatos bem suportados, nao
invente); (b) o que e a plataforma SAPHO e o significado da sigla (verifique as expansoes que
aparecem no codigo/README — pode haver mais de uma); (c) o modelo conceitual SAPHO = AURORA (IDE) +
YANC (compiladores) + toolchain bundle, e os subsistemas PRISM (RTL) e Aurora Intelligence (IA);
(d) o publico-alvo (pesquisa e ensino em arquitetura de computadores / projeto de soft-processors);
(e) um panorama de ALTO NIVEL do fluxo (projeto -> C+- -> compilacao -> simulacao -> ondas/RTL),
deixando o detalhe para os capitulos seguintes; (f) a convencao de nomes (AURORA, YANC, SAPHO, PRISM,
Aurora Intelligence) e uma unica frase de que POLARIS foi um sucessor descontinuado. Termine com um
"mapa do documento" listando os 18 capitulos. Plataforma suportada hoje (verifique no codigo:
electron-builder so faz target Windows/NSIS; YANC roda Win+Linux).`,
  },
  {
    id: '02-arquitetura-soft-processor-sapho', file: '02-arquitetura-soft-processor-sapho.tex',
    title: 'A arquitetura do soft-processor SAPHO',
    scope: `Documente o PROCESSADOR que o pipeline gera. FONTE DA VERDADE: os modulos Verilog em
C:/Users/chrys/Documents/GitHub/yanc/HDL/ (core.v, ula.v, processor.v, instr_dec.v, addr_dec.v,
myFIFO.v) e o back-end que os emite (yanc/Compilers/ASMComp/Sources). Cubra: o estilo de arquitetura
(leia o RTL e descreva: tipo de datapath, registradores/acumulador, memorias Harvard de programa e
dados, larguras configuraveis); o conjunto de instrucoes / opcodes (procure tabelas de opcode em
ASMComp e arquivos trad_opcode*); as unidades aritmeticas (ULA: inteiro, ponto-fixo, ponto-flutuante,
complexos); I/O (portas in/out, FIFOs); as imagens de memoria geradas (.mif) e como o testbench
(_tb.v) e gerado. Inclua trechos de Verilog reais (lstlisting language=Verilog) ilustrando a
estrutura. Explique como os parametros de hardware do C+- (numero de bits etc.) parametrizam o core.`,
  },
  {
    id: '03-linguagem-cmm', file: '03-linguagem-cmm.tex',
    title: 'A linguagem C± (CMM) e o caminho C++',
    scope: `Documente a LINGUAGEM C+- (CMM) a partir da GRAMATICA REAL: leia o scanner Flex (.l) e o
parser Bison (.y) e fontes em C:/Users/chrys/Documents/GitHub/yanc/Compilers/CMMComp/Sources (e
Headers). Cubra: estrutura de um programa (declaracao de processor, secoes), os TIPOS de dados
(inteiro, ponto-fixo/fixed, ponto-flutuante/float, numeros complexos/comp, e operadores em notacao de
Dirac/bra-ket se existirem — confirme no codigo), declaracao de variaveis, operadores (incluindo os
de ponto-fixo, complexos e Dirac), controle de fluxo, funcoes, I/O (in/out, fout, etc.), as DIRETIVAS
de hardware (numero de bits, MABits/MIBits, gain, datatype — confirme os nomes exatos no parser),
includes e MACROS (yanc/Compilers/CMMComp/Includes: float_sqrt, float_sin, float_atan, lookup tables
etc.). Liste o catalogo de mensagens de erro que o compilador emite (procure no codigo; veja tambem
NegTests). De exemplos reais tirados de CMMComp/Tests/*.cmm (lstlisting style=cmm). Depois, em uma
secao menor, o CAMINHO C++: o que cppcomp/cpppp aceitam, headers em CPPComp/Includes, e os Tests.
Pode cruzar com aurora/resources/sapho_rules.json (artefato DERIVADO) mas verifique contra a gramatica.`,
  },
  {
    id: '04-yanc-compiladores', file: '04-yanc-compiladores.tex',
    title: 'YANC: os compiladores e o pipeline de tradução',
    scope: `Documente os BINARIOS do YANC e a cadeia de traducao. FONTE: C:/Users/chrys/Documents/
GitHub/yanc (Compilers/*, Makefile, Scripts/*, Compilers/yanc_version.h). Para CADA binario explique
entrada->saida e como e construido (Flex/Bison/GCC; note o cross-compile x86_64-w64-mingw32 para .exe
sem dependencia de DLL): cmmcomp (C+- -> .asm), cppcomp (C++ -> .asm), cpppp (preproc C++), appcomp
(1a passada do .asm: coleta parametros do processador e resolve enderecos de variaveis/labels),
asmcomp (.asm -> .v + .mif + _tb.v), comp2gtkw (padrao de bits de complexos -> GTKWave) e gen_gtkw
(le header de VCD -> escreve .gtkw formatado). Descreva o formato do .asm intermediario e a
"side-table" que mapeia cada valor de PC para a linha-fonte C+- (base do trace em lockstep). Documente
os scripts de orquestracao (single_proc, multi_proc, single_proc_cpp, setup, regress, env) e o flag
--sim iverilog|verilator. Inclua um diagrama ASCII do pipeline. Use os fontes .c reais como evidencia.`,
  },
  {
    id: '05-aurora-arquitetura', file: '05-aurora-arquitetura.tex',
    title: 'AURORA IDE: arquitetura geral',
    scope: `Documente a arquitetura da app Electron. FONTE: C:/Users/chrys/Documents/GitHub/aurora
(main.js, main/*.js, preload*.js, js/app/*). Cubra: separacao processo main x renderer; main.js
(switches de GPU, ciclo de vida do app); as BrowserWindows criadas em main/windows.js (main, splash,
update, prism — quantas e com que opcoes: contextIsolation, nodeIntegration, sandbox, preload
dedicado por janela); a TOPOLOGIA IPC — enumere os modulos main/ipc/* (ai, compile, files, git,
github_auth, prism, project, search, system) e o papel de cada; os preloads (preload.js e os de
prism/update/splash) como ponte segura; main/state.js (estado do main), main/lifecycle.js,
main/paths.js, main/process_registry.js (rastreio e tree-kill de processos filhos), main/temp_gc.js,
main/logger.js (electron-log: caminhos de log por SO), main/render_loader.js / scripts/launch-
electron.js (como o renderer bundlado pelo Vite e carregado), main/utils.js. Conte quantos handlers
ipcMain existem (grep) e descreva o padrao "renderer orquestra, main executa". Diagrama ASCII da
topologia de processos/janelas/IPC.`,
  },
  {
    id: '06-aurora-editor', file: '06-aurora-editor.tex',
    title: 'AURORA: o editor de código',
    scope: `Documente o subsistema de edicao. FONTE: aurora/js/editor/*, aurora/js/tabs/*, e qualquer
registro de linguagem Monaco (grep por monaco.languages). Cubra: o Monaco Editor (versao fixada
exatamente em 0.52.2 — confirme em package.json e em check-pinned-versions; loader AMD); o
EditorManager (monaco_editor.js) e o ciclo de criacao via TabManager.addTab; o SharedModelRegistry
(shared_models) — modelos de texto compartilhados entre paineis com refcount; o TabManager (abas,
ordem, persistencia); o split editor (ate quantos paineis; como editam o mesmo modelo ao vivo); o
realce de sintaxe (definicoes Monarch para C+-, assembly e Verilog — descreva keywords/regras reais);
as decorations (ex.: bra-ket, barra vertical) e o find. Inclua os contratos de inicializacao reais
(EditorManager.ready). Trechos de codigo reais como evidencia.`,
  },
  {
    id: '07-aurora-projeto-arvore', file: '07-aurora-projeto-arvore.tex',
    title: 'AURORA: projeto, processadores e árvore de arquivos',
    scope: `Documente o modelo de projeto e a navegacao. FONTE: aurora/js/project/*, aurora/js/tree/*,
aurora/js/processors/*, aurora/main/ipc/project.js, aurora/main/recents.js. Cubra: o arquivo de
projeto .spf (FORMATO real — leia spf_store.ts e exemplos; campos: processadores, synthesizableFiles,
testbenchFiles, topLevelFile, testbenchFile, metadata, etc.); o ProjectStore (dono do caminho/spf) e
o SpfStore (escritor unico serializado, STRUCTURE_DEFAULTS); criar/abrir/fechar projeto; os
PROCESSADORES (criar/renomear/deletar, cores por processador); as TRES views da arvore de arquivos
(standard / verilog picker / hierarchy) e o controlador unico (tree_view.js,
file_tree_view_controller.js, file_mode.js, project_tree_render.js, standard_tree_render.js); a tela
de boas-vindas / projetos recentes (recents.js); e backups (zip sob demanda). Verifique tudo no
codigo. Diagrama da estrutura de um projeto no disco.`,
  },
  {
    id: '08-aurora-compilacao', file: '08-aurora-compilacao.tex',
    title: 'AURORA: o subsistema de compilação',
    scope: `Documente como a IDE orquestra a compilacao. FONTE: aurora/js/compilation/* (incl.
compilation_module.js, compilation_flow.js, builders/*), aurora/main/compile/* (executor.js,
binary_allowlist.js, protected_flags.js, python_locator.js), aurora/main/ipc/compile.js. Cubra: como
os botoes da toolbar montam a sequencia (CMM -> ASM -> Verilog -> simulacao); os BUILDERS (liste cada
um em js/compilation/builders e o que faz); o EXECUTOR estruturado no main (CommandSpec validado),
a ALLOWLIST de binarios (liste os ~13 binarios permitidos e de onde a lista vem) e as protected_flags;
a localizacao do Python (python_locator); como o ambiente/PATH do processo filho e montado; o
streaming de saida para o terminal. Distinga os modos de pipeline (simulacao completa vs verilog-only,
auto-decidido por availableProcessors). Evidencie com codigo real.`,
  },
  {
    id: '09-aurora-simulacao-ondas', file: '09-aurora-simulacao-ondas.tex',
    title: 'AURORA: simulação e o fluxo de ondas',
    scope: `Documente a simulacao e a preparacao das ondas. FONTE: aurora/js/wave/* e as fases _wave*
de runGtkWave em aurora/js/compilation/compilation_module.js. Cubra: os QUATRO caminhos de simulacao
(testbench Verilog + Icarus [iverilog+vvp]; testbench Verilog + Verilator; testbench Python/cocotb
rodando em Icarus ou em Verilator) e como o simulador e escolhido (Wave Config / flag em localStorage);
as fases do orquestrador (_waveResolveToolchain, _waveDeriveSimTopModule, build/sim por caminho,
_waveResolveVcdFile, _extractFstHeaderVcd, _waveResolveGtkwSaveFile, _waveLaunchGtkwave); o WaveStore
(wave_state_store.ts) com estado por testbench; o parser de sinais (signal_parser.ts); a instrumentacao
do testbench (testbench_instrumenter.ts) e a PRECEDENCIA de "o que dumpar" ($dumpvars): .gtkw ativo >
Wave Configuration customizada > $dumpvars manual no tb > default; a validacao de selecao
(selection_validator.ts); os escritores de .gtkw (gtkw_writer.ts, gtkw_proc_writer.ts) e a decodificacao
de complexos (complex_decode.ts / comp2gtkw). NAO documente o visualizador em si (cap. 10). Diagrama
ASCII do fluxo de 4 caminhos convergindo no .fst/.vcd.`,
  },
  {
    id: '10-aurora-visualizacao-gtkwave-surfer', file: '10-aurora-visualizacao-gtkwave-surfer.tex',
    title: 'AURORA: visualização de ondas (GTKWave e Surfer)',
    scope: `Documente os VISUALIZADORES de onda. FONTE: o fork C:/Users/chrys/Documents/GitHub/
gtkwave-nipscern (src/, meson.build, CHANGELOG.md, changes_from_gtk2.txt; README so como pista),
aurora/components/Scripts/download-gtkwave-nipscern.js e download-surfer.js, e os arquivos de Surfer
em aurora/js/wave (surfer_layout_writer.ts e correlatos). Cubra: (A) GTKWave fork nipscern — quais
CUSTOMIZACOES de UI/comportamento vs upstream (verifique no codigo/commits do fork: ex. zoom-fit,
painel de sinais escuro, remocao do SST, nomes a esquerda), como e construido (meson/MSYS2) e o papel
do .gtkw gerado e do fst2vcd; (B) Surfer — viewer opt-in: como e baixado/integrado, o layout
declarativo .surf.ron escrito por buildSurferLayout (grupos colapsaveis por processador, cores,
aliases, tracks Assembly/C+- via mapping translators de trad_opcode/trad_cmm, complexos via pre-pass
comp2gtkw), e onde as configs sao gravadas. Confirme no codigo o estado real da integracao do Surfer
(default-on, opt-in ou experimental).`,
  },
  {
    id: '11-aurora-prism-rtl', file: '11-aurora-prism-rtl.tex',
    title: 'AURORA: o visualizador de RTL PRISM',
    scope: `Documente o PRISM. FONTE: aurora/main/ipc/prism.js, o(s) preload/janela PRISM em
main/windows.js, os arquivos de renderer do PRISM (grep por "prism" em js/ e html/), o fork
C:/Users/chrys/Documents/GitHub/_sapho_study/netlistsvg-aurora (lib/, built/, package.json) e as deps
digitaljs / yosys2digitaljs (package.json). Cubra: o pipeline Verilog -> Yosys (qual fluxo: read_verilog
+ hierarchy/proc + write_json) -> netlistsvg-aurora -> SVG renderizado na janela PRISM; o que o fork
netlistsvg-aurora muda vs @silimate/netlistsvg upstream (verifique: tsconfig fixes, skins/cells); a
arvore de hierarquia gerada pos-sintese; e a presenca/estado de DigitalJS + yosys2digitaljs
(confirme no codigo se a simulacao visual interativa esta de fato integrada ou apenas presente como
dependencia). Evidencie com codigo real.`,
  },
  {
    id: '12-aurora-intelligence-ia', file: '12-aurora-intelligence-ia.tex',
    title: 'AURORA: o subsistema Aurora Intelligence (IA)',
    scope: `Documente o Aurora Intelligence (IMPLEMENTADO POR COMPLETO; o provider/modelos PROPRIOS do
lab ainda NAO foram treinados — declare isso). FONTE: aurora/main/ai/* (provider.js, chat.js,
claude_code.js, codex_cli.js, cli_downloader.js, cli_locator.js, cli_manifest.js, aurora_mcp_server.js,
tools.js, tool_bridge.js, keystore.js, conversations.js, audit.js, attachments.js, prefs.js),
aurora/main/ipc/ai.js, aurora/js/ai/* e aurora/js/ui/ai_assistant_manager.js. Cubra: os DOIS
transportes que convergem nos mesmos eventos de chat — (1) Vercel AI SDK (streamText) para provedores
com chave de API (liste-os a partir das deps @ai-sdk/*: anthropic, openai, google, groq, deepseek) e
(2) CLIs por assinatura (Claude Code da Anthropic e Codex da OpenAI) operando contra um servidor MCP
HTTP LOCAL em 127.0.0.1:porta-efemera; o numero e a natureza das TOOLS expostas (conte em tools.js;
categorias: leitura, escrita, compilacao, projeto...); o tool_bridge (ai:tool-exec/ai:tool-result);
o keystore com criptografia DPAPI/safeStorage (chaves nunca legiveis de volta); conversations/audit/
attachments/prefs; e o painel no renderer. Sobre modelos: descreva a governanca de modelos
(provider.js / DEFAULT_MODELS) factualmente. Deixe claro o status do modelo proprio do lab (planejado,
nao treinado). NAO mencione vulnerabilidades.`,
  },
  {
    id: '13-aurora-produtividade', file: '13-aurora-produtividade.tex',
    title: 'AURORA: ferramentas de produtividade',
    scope: `Documente os recursos auxiliares de produtividade da IDE. FONTE (verifique cada um no
codigo): terminal de saida (aurora/js/terminal/* — line-numbers clicaveis, cards por tipo, progresso
de teste); Git / Source Control embutido (aurora/main/ipc/git.js usando simple-git, github_auth.js,
diff2html, e aurora/js/git/*); busca no projeto (aurora/main/ipc/search.js — confirme o motor:
ripgrep ou outro); LSP de Verilog (aurora/main/lsp/verible_lsp.js = Verible; slang_lsp.js = slang-
server) integrados ao Monaco via markers; tree-sitter (aurora/main/treesitter/grammars.js + dep
web-tree-sitter, gramaticas baixadas) para folding/outline; formatacao com clang-format
(aurora/main/format/clang_format.js); command palette; internacionalizacao i18n (aurora/js/i18n/* e
aurora/locales/* — quais locales); painel de configuracoes; o auto-updater (aurora/main/updater.js +
electron-updater) do ponto de vista do usuario (o capitulo 16 cobre o lado de release); e o overlay de
desenvolvimento (js/dev). Para cada recurso: o que faz, qual ferramenta o sustenta, e como esta ligado.`,
  },
  {
    id: '14-toolchain-bundle', file: '14-toolchain-bundle.tex',
    title: 'O toolchain bundle (aurora-toolchain)',
    scope: `Documente o repo aurora-toolchain. FONTE: C:/Users/chrys/Documents/GitHub/_sapho_study/
aurora-toolchain (build/10..60 *.sh, manifest.txt; README so como pista — VERIFIQUE nos scripts). Cubra:
o que o bundle aurora-msys-vN.zip contem (um prefixo msys/mingw64 + utils msys/usr/bin: iverilog+vvp,
verilator+verilator_bin, yosys, g++/gcc/cc1plus, perl, make, ccache, python 3.12 + cocotb 2.0.1 com os
DOIS VPIs); a RECEITA cocotb-on-Verilator (a parte dificil: por que o wheel do cocotb nao traz o VPI de
Verilator no Windows e como o .a estatico libcocotbvpi_verilator.a e construido a mao com
-DPLI_DLLISPEC=, e o patch em cocotb_tools/runner.py); os PINS criticos (gcc 15.1.0-5 porque o 16.1.0-5
quebra libstdc++; python 3.12.11-1 porque cocotb linka -lpython3.X) e os floating (iverilog 13, yosys
0.56, verilator 5.048); o pipeline de build em ordem (instalar pacotes pinados via pacman -U a partir de
um release pins-vN; build do VPI; assemble; trim ~40%; SMOKE 4/4 obrigatorio; package); e como a AURORA
consome (download-toolchain.js: tag, sentinelas verificadas). Tabela do manifest com versoes/razoes.`,
  },
  {
    id: '15-catalogo-terceiros', file: '15-catalogo-terceiros.tex',
    title: 'Catálogo de ferramentas de terceiros',
    scope: `Produza o CATALOGO COMPLETO das ferramentas de terceiros que o SAPHO usa, orquestra ou
empacota. FONTE PRIMARIA: aurora/package.json (dependencies E devDependencies, com versoes EXATAS),
aurora-toolchain/manifest.txt, aurora/components/Scripts/download-*.js (toolchain, yanc, gtkwave,
surfer, verible, clang-format, slang-server, tree-sitter-grammars, norse-font), aurora/THIRD_PARTY_
NOTICES.md (pista) e aurora/LICENSE. Para CADA ferramenta: nome, versao (do package.json/manifest —
nao chute), licenca (confirme), e PAPEL no SAPHO. Organize em LONGTABLES por categoria: (a) runtime da
app (Electron 39, Node); (b) editor/UI (Monaco 0.52.2, Lit, KaTeX, jQuery/jQuery-UI, Phosphor icons,
diff2html, fonte Norse); (c) toolchain EDA (Icarus Verilog 13, Verilator 5.048, Yosys 0.56, GTKWave
fork, cocotb 2.0.1, netlistsvg fork, DigitalJS, yosys2digitaljs, 7-Zip); (d) linguagem/LSP/format
(Verible, slang-server, web-tree-sitter + gramaticas, clang-format); (e) ondas (Surfer); (f) IA
(@ai-sdk/anthropic|openai|google|groq|deepseek, ai, @anthropic-ai/claude-code, @openai/codex,
@modelcontextprotocol/sdk, zod); (g) build/infra (Vite 8, electron-builder, electron-updater,
electron-log, chokidar, fs-extra, simple-git); (h) qualidade/dev (TypeScript, ESLint, vitest, playwright,
happy-dom, husky, knip, commitlint, release-please). Confirme cada versao lendo o package.json.`,
  },
  {
    id: '16-build-distribuicao', file: '16-build-distribuicao.tex',
    title: 'Build, empacotamento e distribuição',
    scope: `Documente como a AURORA e construida e distribuida. FONTE: aurora/package.json (scripts e o
bloco "build"), aurora/vite.config.mjs, aurora/scripts/* (check-pinned-versions, dev.js, launch-
electron.js, sync-sapho-rules.js), aurora/components/Scripts/* (os downloaders + copy-components),
aurora/.github/workflows/* (ci.yml, release.yml, release-please.yml), aurora/build/* (installer.nsh),
aurora/docs/CODE_SIGNING.md (pista). Cubra: o BOOTSTRAP (npm run bootstrap: check de versoes pinadas +
9 downloaders + copy-components — o que cada downloader baixa e de onde); o build do renderer com Vite
(vite.config: base ./ para file://, vendorizacao de Monaco/KaTeX/Phosphor em dist/vendor) e o tsc
in-place; o electron-builder (config build: appId, target NSIS x64, asarUnpack, listas files/
extraResources, fileAssociations .spf, protocolo sapho://); o instalador NSIS (installer.nsh); o
auto-updater (electron-updater; feed apontando para o canal de release; latest.yml + blockmap); os
workflows de CI e de release e o release-please; a assinatura de codigo (status segundo CODE_SIGNING.md
e configs — descritivo); e o SPLIT INTENCIONAL de repos: aurora = desenvolvimento da IDE, sapho = canal
de distribuicao estavel (o instalador sapho-aurora-Setup-vX.Y.Z.exe sai do repo sapho). Diagrama do
fluxo de build.`,
  },
  {
    id: '18-engenharia-evolucao', file: '18-engenharia-evolucao.tex',
    title: 'Engenharia, qualidade e evolução do projeto',
    scope: `Duas partes. PARTE A — Engenharia/qualidade (FONTE: aurora/tests/*, vitest.config.js,
vitest.config.e2e.js, eslint.config.mjs, knip.config.js, commitlint.config.mjs, .husky/*, tsconfig.json,
.editorconfig, .github/workflows/ci.yml): descreva a estrategia de testes (vitest unit + e2e Playwright
no Electron), lint (ESLint flat config), deteccao de codigo morto (knip), hooks de git (husky +
lint-staged), conventional commits (commitlint), TypeScript (compila in-place), e o CI. PARTE B —
EVOLUCAO via historico de git: analise o historico COMPLETO de commits do aurora (rode no Bash:
git -C /c/Users/chrys/Documents/GitHub/aurora log --oneline | wc -l; git ... shortlog -sn;
git ... tag; git ... log --pretty para marcos). Construa uma LINHA DO TEMPO: marcos e grandes mudancas
(ex.: introducao do Vite, "revamp" visual, consolidacao para modo unico, remocao dos modos
Processor/Verilog, embed de Source Control, Surfer/Verible/tree-sitter), a progressao de versoes
(tags, ate 6.3.2), e os contribuidores (quem commita; note colaboracao via branches). Faca o mesmo,
brevemente, para o repo yanc (git -C /c/Users/chrys/Documents/GitHub/yanc). Apresente como tabela
cronologica + texto. Baseie-se nos COMMITS REAIS, nao em CHANGELOG.md.`,
  },
]

// ---------------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------------
const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'file', 'sections', 'filesStudied', 'selfRating'],
  properties: {
    id: { type: 'string' },
    file: { type: 'string' },
    sections: { type: 'array', items: { type: 'string' }, description: 'titulos das secoes escritas' },
    filesStudied: { type: 'array', items: { type: 'string' }, description: 'arquivos de codigo realmente abertos' },
    notes: { type: 'string', description: 'observacoes (ex.: divergencias doc-vs-codigo, status de roadmap)' },
    selfRating: { type: 'integer', minimum: 1, maximum: 5 },
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'file', 'status', 'latexIssuesFixed', 'factualCorrections', 'residualRisks'],
  properties: {
    id: { type: 'string' },
    file: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'fixed', 'problems'] },
    latexIssuesFixed: { type: 'array', items: { type: 'string' } },
    factualCorrections: { type: 'array', items: { type: 'string' } },
    residualRisks: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------------
// PROMPTS
// ---------------------------------------------------------------------
function writePrompt(ch) {
  return `${SHARED}

== SEU CAPITULO ==
ID: ${ch.id}
TITULO (use exatamente em \\chapter): ${ch.title}
ARQUIVO DE SAIDA (caminho absoluto — sobrescreva o placeholder existente):
${OUT}/${ch.file}

ESCOPO:
${ch.scope}

TAREFA:
1) Estude PROFUNDAMENTE o codigo-fonte relevante (abra os arquivos; nao deduza da documentacao).
2) Escreva o capitulo LaTeX completo, exaustivo e em PT-BR, seguindo TODAS as convencoes LaTeX acima.
3) Faca Read no arquivo de saida (placeholder) e entao Write o conteudo final inteiro nele.
4) Retorne o objeto estruturado pedido (StructuredOutput).
Lembre: tom descritivo, sem criticas/vulnerabilidades; codigo e a fonte da verdade; chaves e ambientes
LaTeX balanceados; nada de caractere especial cru em texto.`
}

function reviewPrompt(ch) {
  return `${SHARED}

== REVISAO TECNICA + LaTeX DO CAPITULO ${ch.id} ==
Arquivo (caminho absoluto): ${OUT}/${ch.file}
Titulo esperado: ${ch.title}

TAREFA (faca Read no arquivo primeiro; corrija no proprio arquivo com Edit):
1) PRECISAO FATUAL: pegue 5-10 afirmacoes tecnicas concretas do capitulo (versoes, nomes de arquivo/
   funcao, comportamento) e CONFIRME no codigo-fonte real. Se algo estiver errado/inventado/nao
   confirmavel, corrija para refletir o codigo (ou remova). O codigo vence a documentacao.
2) CORRETUDE LaTeX: garanta que o arquivo comeca com "% !TEX root = ../main.tex" e \\chapter{...} +
   \\label{cap:${ch.id}}; que NAO ha preambulo; que todo \\begin{...} tem \\end{...}; todo lstlisting
   esta fechado; chaves balanceadas; nenhum caractere especial cru em texto normal (_ % & # $ etc.
   escapados ou dentro de \\lstinline/\\path/\\texttt); tabelas tabularx/longtable bem formadas;
   apenas comandos/pacotes permitidos no preambulo. Conserte tudo que puder quebrar a compilacao.
3) TOM: remova qualquer critica/vulnerabilidade/recomendacao que tenha escapado (deve ser descritivo).
Retorne o objeto estruturado (StructuredOutput) listando o que corrigiu e riscos residuais.`
}

// ---------------------------------------------------------------------
// EXECUCAO
// ---------------------------------------------------------------------
phase('Capitulos')
log(`Iniciando estudo+escrita de ${CHAPTERS.length} capitulos (com revisao por capitulo)...`)

const results = await pipeline(
  CHAPTERS,
  (ch) => agent(writePrompt(ch), {
    label: `escreve:${ch.id}`, phase: 'Capitulos', agentType: 'claude',
    effort: 'high', schema: WRITE_SCHEMA,
  }),
  (writeRes, ch) => agent(reviewPrompt(ch), {
    label: `revisa:${ch.id}`, phase: 'Capitulos', agentType: 'claude',
    effort: 'high', schema: REVIEW_SCHEMA,
  }),
)

// ---- Sintese: capitulo 17 (le os capitulos ja escritos) ----
phase('Sintese')
log('Escrevendo o capitulo 17 (pipeline ponta-a-ponta), que le os capitulos ja escritos...')

const ch17 = {
  id: '17-pipeline-ponta-a-ponta', file: '17-pipeline-ponta-a-ponta.tex',
  title: 'O pipeline de criação ponta a ponta',
}
const ch17Prompt = `${SHARED}

== SEU CAPITULO (SINTESE) ==
ID: ${ch17.id}
TITULO: ${ch17.title}
ARQUIVO DE SAIDA: ${OUT}/${ch17.file}

Este e um capitulo de SINTESE que costura o fluxo completo, do zero ao resultado. Os outros 17
capitulos JA FORAM ESCRITOS no diretorio ${OUT}/ — voce PODE le-los (Read/Grep) para manter
consistencia de nomes e usar \\autoref{cap:<id>}, MAS verifique o fluxo contra o codigo real
(principalmente aurora/js/compilation/compilation_module.js e os scripts yanc/Scripts/single_proc.*
e multi_proc.*).

Documente, em ordem, o caminho de criacao ponta-a-ponta com os ARTEFATOS de cada etapa:
1) Criar projeto .spf e processadores na AURORA.
2) Escrever C+- (.cmm) [ou C++ (.cpp)].
3) Compilar: cmmcomp -> .asm ; appcomp (params/enderecos) ; asmcomp -> .v + .mif + _tb.v.
4) Simular: Icarus (iverilog+vvp) OU Verilator OU cocotb (Python), conforme escolha.
5) Instrumentar o dump ($dumpvars conforme a selecao de sinais).
6) Visualizar ondas: GTKWave (fork) ou Surfer, com tracks C+-/assembly/variaveis em lockstep com o clock.
7) Inspecionar o RTL no PRISM (Yosys -> netlistsvg).
Mostre QUEM invoca o que (renderer orquestra; main executa via executor + allowlist). Inclua um
DIAGRAMA ASCII grande (lstlisting) do pipeline inteiro com os artefatos. Use \\autoref para apontar aos
capitulos de detalhe. Faca Read no placeholder e Write o conteudo final. Siga as convencoes LaTeX.
Retorne o StructuredOutput.`

const r17 = await agent(ch17Prompt, {
  label: 'escreve:17-pipeline', phase: 'Sintese', agentType: 'claude',
  effort: 'high', schema: WRITE_SCHEMA,
})
const r17rev = await agent(reviewPrompt(ch17), {
  label: 'revisa:17-pipeline', phase: 'Sintese', agentType: 'claude',
  effort: 'high', schema: REVIEW_SCHEMA,
})

return {
  capitulos: results.filter(Boolean),
  cap17: r17rev,
  resumo: `${results.filter(Boolean).length}/${CHAPTERS.length} capitulos + cap.17 processados`,
}
