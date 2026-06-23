export const meta = {
  name: 'sapho-referencia-compacta',
  description: 'Destila os 18 capitulos verificados em um documento article compacto e denso (<=20 paginas), uma secao por agente, com etapa de poda/aperto LaTeX.',
  phases: [{ title: 'Destilacao', detail: 'Comprime cada capitulo numa secao densa com orcamento de palavras' }],
}

const SRC = 'C:/Users/chrys/Documents/GitHub/aurora/docs/referencia-tecnica-sapho/capitulos'
const SEC = 'C:/Users/chrys/Documents/GitHub/aurora/docs/referencia-tecnica-sapho/secoes'

const SHARED = `
Voce esta produzindo a EDICAO COMPACTA de uma referencia tecnica da plataforma SAPHO (a IDE AURORA +
os compiladores YANC + toolchain), em PORTUGUES DO BRASIL. A versao extensa (capitulos) JA EXISTE e
JA FOI VERIFICADA contra o codigo-fonte. Sua tarefa e DESTILAR um capitulo-fonte numa SECAO densa.

REGRAS:
- FONTE: leia o(s) arquivo(s)-fonte indicado(s). Eles ja foram verificados contra o codigo; confie
  neles e NAO invente fatos novos. Se um fato nao estiver na fonte, nao o inclua. (Pode abrir o
  codigo so para desempatar duvidas pontuais.)
- META DE TAMANHO: o documento inteiro deve caber em ATE 20 paginas, entao sua secao tem ORCAMENTO
  RIGIDO de palavras (informado abaixo). Conte e respeite. Densidade > prosa: cada frase carrega um
  fato tecnico. SEM introducoes floreadas, SEM repeticao, SEM frases de ligacao vazias.
- PRIORIZE: tabelas densas, listas curtas, no maximo UM exemplo/diagrama essencial por secao. Corte
  detalhes secundarios; preserve os fatos de maior valor (nomes de ferramentas/arquivos/funcoes,
  versoes, papeis, o fluxo, os numeros).
- TOM DESCRITIVO/NEUTRO: o que o sistema E e FAZ. SEM vulnerabilidades, SEM criticas, SEM
  recomendacoes, SEM "divida tecnica".
- CORRECOES DO DONO: POLARIS esta descontinuado (nao documente). Aurora Intelligence esta TOTALMENTE
  implementado, mas o provider/modelos PROPRIOS do lab ainda NAO foram treinados (roadmap) — declare
  isso quando relevante (secao de IA).

LaTeX (classe article; o preambulo ja existe em main-compacto.tex):
- Escreva APENAS o corpo. O arquivo de saida JA EXISTE como placeholder: faca Read e SOBRESCREVA com
  Write (conteudo inteiro).
- Linha 1: "% !TEX root = ../main-compacto.tex". Depois "\\section{<TITULO DADO>}" e "\\label{sec:<ID>}".
- Use \\subsection com parcimonia. Disponiveis: booktabs, tabularx (colunas Y e Z densas), longtable,
  enumitem, listings (use \\scriptsize ja default; ambiente lstlisting; inline \\lstinline|...| ou
  \\path{...} ou \\texttt{...}), hyperref (\\url). Macros: \\cmm, \\repo{nome}, \\file{cam}, \\tool{NOME},
  \\code{...}.
- NUNCA caractere especial cru em texto (_ % & # $ -> escape ou \\lstinline/\\path/\\texttt). Todo
  \\begin{X} com \\end{X}; lstlisting fechado; chaves balanceadas. Diagramas em lstlisting ASCII; SEM
  TikZ, SEM imagens. NAO emita preambulo. Nao ha compilador aqui — seja meticuloso.
`.trim()

const SECTIONS = [
  { id: 'S01-visao-geral', title: 'Visão geral e contexto', src: ['01-contexto-visao-geral.tex'], budget: 450,
    focus: 'NIPSCERN/UFJF; o que e SAPHO (e a sigla); modelo SAPHO = AURORA(IDE)+YANC(compiladores)+toolchain; subsistemas PRISM e Aurora Intelligence; publico-alvo; fluxo de alto nivel em 1 frase ou mini-diagrama; plataforma suportada (Windows p/ a IDE). 1 frase de que POLARIS foi sucessor descontinuado.' },
  { id: 'S02-soft-processor', title: 'A arquitetura do soft-processor SAPHO', src: ['02-arquitetura-soft-processor-sapho.tex'], budget: 600,
    focus: 'estilo de datapath/registradores; memorias Harvard programa/dados; larguras configuraveis; ULA (int/fixo/float/complexo); I/O e FIFOs; .mif e _tb.v gerados; UM trecho Verilog minusculo OU uma tabela de modulos HDL (core/ula/processor/instr_dec/addr_dec/myFIFO) e seus papeis; nocao do ISA/opcodes.' },
  { id: 'S03-linguagem-cmm', title: 'A linguagem C±', src: ['03-linguagem-cmm.tex'], budget: 650,
    focus: 'estrutura de um programa (processor); TIPOS (int, fixed, float, complex/comp, Dirac se existir) em TABELA; diretivas de hardware (numBits/MABits/MIBits/gain/datatype) em tabela; I/O (in/out/fout); includes/macros (float_sqrt/sin/atan); UM exemplo .cmm curto (lstlisting style=cmm). Mencionar caminho C++ em 1-2 frases.' },
  { id: 'S04-yanc-pipeline', title: 'YANC: compiladores e pipeline de tradução', src: ['04-yanc-compiladores.tex'], budget: 600,
    focus: 'TABELA dos binarios (cmmcomp/cppcomp/cpppp/appcomp/asmcomp/comp2gtkw/gen_gtkw): entrada->saida + como construido (flex/bison/gcc, cross x86_64-w64-mingw32); o .asm intermediario; a side-table PC->linha-fonte; um DIAGRAMA ASCII do pipeline; scripts single_proc/multi_proc e flag --sim.' },
  { id: 'S05-aurora-arquitetura', title: 'AURORA: arquitetura da IDE', src: ['05-aurora-arquitetura.tex'], budget: 560,
    focus: 'Electron main x renderer; as BrowserWindows (main/splash/update/prism) com contextIsolation/nodeIntegration/preload; TABELA dos modulos main/ipc/* e seus papeis; estado/lifecycle/process_registry(tree-kill)/logger; padrao "renderer orquestra, main executa"; renderer bundlado por Vite.' },
  { id: 'S06-edicao-projeto-arvore', title: 'Edição, projeto e árvore de arquivos', src: ['06-aurora-editor.tex','07-aurora-projeto-arvore.tex'], budget: 620,
    focus: 'Monaco 0.52.2 (loader AMD, EditorManager, SharedModelRegistry, TabManager, split, sintaxe Monarch C±/asm/Verilog); o .spf (campos principais em lista) + SpfStore/ProjectStore; processadores (cores); as 3 views da arvore (standard/verilog/hierarchy) com controlador unico; recentes/backups. Seja muito conciso, e a fusao de 2 capitulos.' },
  { id: 'S07-compilacao-simulacao', title: 'Compilação e simulação na IDE', src: ['08-aurora-compilacao.tex','09-aurora-simulacao-ondas.tex'], budget: 720,
    focus: 'orquestracao no renderer (compilation_module/flow + builders) -> executor no main (CommandSpec + allowlist de ~13 binarios + protected_flags); montagem de PATH/env; streaming pro terminal; os 4 CAMINHOS de simulacao (tb Verilog+Icarus; tb Verilog+Verilator; cocotb em Icarus/Verilator) e a escolha; a PRECEDENCIA de $dumpvars (.gtkw ativo > Wave Config > $dumpvars manual > default); instrumentacao/validacao. DIAGRAMA ASCII dos 4 caminhos convergindo no .fst/.vcd. Fusao de 2 capitulos — muito denso.' },
  { id: 'S08-visualizacao-ondas-rtl', title: 'Visualização: ondas (GTKWave/Surfer) e RTL (PRISM)', src: ['10-aurora-visualizacao-gtkwave-surfer.tex','11-aurora-prism-rtl.tex'], budget: 640,
    focus: 'GTKWave fork nipscern: principais customizacoes vs upstream + papel do .gtkw/fst2vcd; Surfer: viewer opcional, layout .surf.ron (grupos por processador, tracks Assembly/C± via mappings, complexos via comp2gtkw), estado real da integracao; PRISM: pipeline Verilog->Yosys(write_json)->netlistsvg-aurora->SVG na janela PRISM + o que o fork muda; estado de DigitalJS/yosys2digitaljs. Fusao de 2 capitulos.' },
  { id: 'S09-aurora-intelligence', title: 'Aurora Intelligence (IA)', src: ['12-aurora-intelligence-ia.tex'], budget: 560,
    focus: 'DOIS transportes convergindo no chat: (1) Vercel AI SDK p/ provedores com chave (anthropic/openai/google/groq/deepseek) (2) CLIs por assinatura (Claude Code, Codex) via servidor MCP HTTP local; numero/natureza das tools + tool_bridge; keystore DPAPI/safeStorage; conversations/audit/prefs. STATUS: implementado por completo; provider/modelos PROPRIOS do lab ainda NAO treinados (roadmap).' },
  { id: 'S10-produtividade', title: 'Ferramentas de produtividade', src: ['13-aurora-produtividade.tex'], budget: 460,
    focus: 'TABELA recurso -> ferramenta -> o que faz: terminal (line-numbers clicaveis/cards), Git/Source Control (simple-git+diff2html+github_auth), busca no projeto (motor real), LSP Verilog (Verible + slang-server -> markers Monaco), tree-sitter (web-tree-sitter), clang-format, command palette, i18n (locales pt/en), settings, auto-updater (visao usuario), overlay dev.' },
  { id: 'S11-toolchain-bundle', title: 'O toolchain bundle', src: ['14-toolchain-bundle.tex'], budget: 460,
    focus: 'conteudo do aurora-msys-vN.zip (iverilog/vvp, verilator, yosys, g++/gcc, perl/make/ccache, python3.12+cocotb2.0.1 com 2 VPIs); a receita cocotb-on-Verilator (VPI estatico .a, -DPLI_DLLISPEC=, patch runner.py) em 2-3 frases; PINS criticos (gcc 15.1.0-5; python 3.12.11-1) e floating (iverilog13/yosys0.56/verilator5.048) em tabelinha; smoke 4/4; como AURORA consome (download-toolchain sentinelas).' },
  { id: 'S12-catalogo-terceiros', title: 'Catálogo de ferramentas de terceiros', src: ['15-catalogo-terceiros.tex'], budget: 720,
    focus: 'UMA LONGTABLE densa: ferramenta | versao | licenca | papel, agrupada por categoria (runtime app; editor/UI; toolchain EDA; linguagem/LSP/format; ondas; IA; build/infra; dev/qualidade). Versoes exatas (do package.json/manifest, ja na fonte). Minima prosa fora da tabela.' },
  { id: 'S13-build-distribuicao', title: 'Build, empacotamento e distribuição', src: ['16-build-distribuicao.tex'], budget: 560,
    focus: 'bootstrap (check de versoes + downloaders + copy-components) em 1-2 frases listando o que baixa; Vite (renderer, vendoriza Monaco/KaTeX/Phosphor) + tsc; electron-builder (NSIS x64, asarUnpack, fileAssociations .spf, protocolo sapho://); auto-updater (electron-updater, feed canal sapho, latest.yml/blockmap); CI/release/release-please; code signing (status); SPLIT intencional aurora(dev) x sapho(distribuicao). Mini-diagrama opcional.' },
  { id: 'S14-pipeline-ponta-a-ponta', title: 'O pipeline de criação ponta a ponta', src: ['17-pipeline-ponta-a-ponta.tex'], budget: 480,
    focus: 'CENTRADO num DIAGRAMA ASCII grande do fluxo: projeto .spf -> C±(.cmm) -> cmmcomp(.asm) -> appcomp -> asmcomp(.v+.mif+_tb.v) -> sim (Icarus/Verilator/cocotb) -> dump (.fst/.vcd) -> ondas (GTKWave/Surfer) + RTL (PRISM). Liste os artefatos por etapa e quem invoca (renderer orquestra, main executa). Pouca prosa, muito diagrama + lista.' },
  { id: 'S15-engenharia-evolucao', title: 'Engenharia, qualidade e evolução', src: ['18-engenharia-evolucao.tex'], budget: 520,
    focus: 'testes (vitest unit + e2e Playwright), lint (ESLint flat), knip, husky+lint-staged, commitlint/Conventional Commits, tsc, CI — em lista curta; e uma TABELA cronologica de marcos/versoes (tags ate 6.3.2: Vite, revamp, modo unico, remocao de modos, Source Control embutido, Surfer/Verible/tree-sitter) + contribuidores. Baseie-se na fonte (que ja analisou os commits).' },
]

const DISTILL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'file', 'wordCount', 'keptHighlights'],
  properties: {
    id: { type: 'string' }, file: { type: 'string' },
    wordCount: { type: 'integer' },
    keptHighlights: { type: 'array', items: { type: 'string' } },
    cut: { type: 'string', description: 'o que foi cortado por orcamento' },
  },
}
const TRIM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'file', 'finalWordCount', 'status', 'fixes'],
  properties: {
    id: { type: 'string' }, file: { type: 'string' },
    finalWordCount: { type: 'integer' },
    status: { type: 'string', enum: ['ok', 'trimmed', 'fixed', 'problems'] },
    fixes: { type: 'array', items: { type: 'string' } },
  },
}

function distillPrompt(s) {
  const srcList = s.src.map(f => `${SRC}/${f}`).join('\n  ')
  return `${SHARED}

== SUA SECAO ==
ID: ${s.id}
TITULO (use em \\section): ${s.title}
ARQUIVO(S)-FONTE (leia e destile):
  ${srcList}
ARQUIVO DE SAIDA (sobrescreva o placeholder): ${SEC}/${s.id}.tex
ORCAMENTO: NO MAXIMO ${s.budget} PALAVRAS (conte de verdade; pode ficar abaixo).
FOCO (o que preservar): ${s.focus}

Leia a(s) fonte(s), destile na secao densa, faca Read no placeholder e Write o conteudo final.
Retorne o StructuredOutput (inclua wordCount real).`
}
function trimPrompt(s) {
  return `${SHARED}

== PODA + APERTO LaTeX: ${s.id} ==
Arquivo: ${SEC}/${s.id}.tex   | ORCAMENTO: ${s.budget} palavras.
Faca Read. (1) Conte as palavras do corpo; se exceder o orcamento em mais de 15%, CORTE o conteudo
menos essencial (mantenha tabelas/fatos/numeros; corte prosa redundante) ate caber. (2) Garanta
LaTeX valido: linha 1 "% !TEX root = ../main-compacto.tex"; \\section + \\label{sec:${s.id}}; sem
preambulo; \\begin/\\end casados; lstlisting fechado; chaves balanceadas; nenhum caractere especial
cru. (3) Tom descritivo (remova qualquer critica). Edite no proprio arquivo. Retorne StructuredOutput.`
}

phase('Destilacao')
log(`Destilando ${SECTIONS.length} secoes a partir dos capitulos verificados (orcamento de palavras por secao)...`)

const results = await pipeline(
  SECTIONS,
  (s) => agent(distillPrompt(s), { label: `destila:${s.id}`, phase: 'Destilacao', agentType: 'claude', effort: 'high', schema: DISTILL_SCHEMA }),
  (_d, s) => agent(trimPrompt(s), { label: `poda:${s.id}`, phase: 'Destilacao', agentType: 'claude', effort: 'medium', schema: TRIM_SCHEMA }),
)

const fin = results.filter(Boolean)
const totalWords = fin.reduce((a, r) => a + (r.finalWordCount || 0), 0)
return { secoes: fin, totalPalavras: totalWords, resumo: `${fin.length}/${SECTIONS.length} secoes; ~${totalWords} palavras no corpo` }
