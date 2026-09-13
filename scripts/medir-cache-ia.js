// medir-cache-ia.js: quanto o cache de prompt e a politica de esforco mudam a
// conta de quem usa a Aurora Intelligence.
//
// POR QUE ESTE MEDIDOR EXISTE. A AURORA e usada por gente de fora do
// laboratorio, e cada pessoa traz a propria credencial. O que se economiza aqui
// nao e custo interno: e a fatura de quem usa a ferramenta, e ela nao aparece
// em lugar nenhum ate chegar. O numero que importa e "quanto custa um turno
// para quem paga", e nao "quantos tokens o cache leu".
//
// AS DUAS COISAS SAO MEDIDAS SEPARADAS, de proposito. Cache e esforco entraram
// na mesma passada porque cada valor distinto de `effort` cria uma linhagem de
// cache propria (main/ai/effort_policy.js), mas medidos juntos um esconde o
// outro: menos tokens com mais raciocinio pode dar a mesma fatura e parecer que
// nada mudou. Entao:
//
//   --so-cache      esforco FIXO nos dois lados, so a montagem muda.
//                   Responde: o corte do prefixo estavel valeu?
//   --so-esforco    montagem FIXA (a nova), so o esforco muda.
//                   Responde: a politica por operacao valeu?
//   (padrao)        mede as duas, uma de cada vez, e imprime as duas contas.
//
// MODOS:
//   node scripts/medir-cache-ia.js
//       Estrutura, sem rede e sem chave. Conta exata de caracteres de cada
//       bloco, onde caem as marcas de cache, e quantas linhagens a politica
//       cria. Isto e medicao, nao estimativa: sao os bytes que vao no pedido.
//
//   node scripts/medir-cache-ia.js --vivo
//       Chamadas de verdade contra a API da Anthropic, com a chave em
//       ANTHROPIC_API_KEY no ambiente. Mede tokens lidos do cache, escritos
//       nele, cobrados inteiros, e o tempo ate o primeiro token. A chave e
//       lida do ambiente e NUNCA impressa, gravada nem passada adiante.
//
//   node scripts/medir-cache-ia.js --vivo --preco-entrada 3 --preco-saida 15
//       O mesmo, com a conta em dinheiro. Os precos sao por milhao de tokens
//       e vem de QUEM RODA: este script nao embute tabela de preco, porque
//       preco muda e numero errado aqui viraria numero errado no paper.
//       Sem eles, a conta sai em "tokens de entrada equivalentes", que e a
//       mesma aritmetica sem a moeda.
//
// O CASO MEDIDO. Dois, os dois reais, cada um com a conversa que ele gera:
//   --caso compilacao   compilar, receber a saida do terminal, perguntar sobre
//                       o erro. E o caso em que o contexto do projeto MUDA no
//                       meio (a pessoa instala um componente), que e o que a
//                       separacao do prefixo protege.
//   --caso onda         abrir a onda, perguntar sobre um sinal, pedir outro
//                       ponto de vista. Conversa mais longa, contexto parado.
//   --caso ambos        os dois (padrao).
//
// AS DUAS MONTAGENS COMPARADAS:
//   antes   system prompt e contexto do projeto CONCATENADOS num bloco so,
//           com uma marca de cache no fim. Era o que a AURORA fazia ate
//           13/09/2026. Mudar uma linha do contexto invalidava o prefixo
//           inteiro.
//   depois  os dois separados, marca ENTRE eles (main/ai/prompt_cache.js).
//
// Ferramenta de manutencao, rodada a mao. Nao entra em workflow: o modo --vivo
// gasta dinheiro de quem roda.

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const promptCache = require(path.join(REPO_ROOT, 'main', 'ai', 'prompt_cache.js'));
const effortPolicy = require(path.join(REPO_ROOT, 'main', 'ai', 'effort_policy.js'));
const tools = require(path.join(REPO_ROOT, 'main', 'ai', 'tools.js'));

// Os multiplicadores da tabela da Anthropic, e a unica aritmetica embutida
// aqui. Nao sao preco: sao o quanto cada tipo de token custa EM RELACAO a um
// token de entrada normal, e e isso que permite dar a conta sem saber o preco.
const MULT = { escrita1h: 2, escrita5m: 1.25, leitura: 0.1, entrada: 1 };

/* ─────────────────────────── argumentos ─────────────────────────── */

function argumentos(argv) {
  const o = {
    vivo: false,
    caso: 'ambos',
    modelo: 'claude-sonnet-4-5',
    precoEntrada: null,
    precoSaida: null,
    soCache: false,
    soEsforco: false,
    esforcoFixo: 'medium',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vivo') o.vivo = true;
    else if (a === '--so-cache') o.soCache = true;
    else if (a === '--so-esforco') o.soEsforco = true;
    else if (a === '--caso') o.caso = argv[++i];
    else if (a === '--modelo') o.modelo = argv[++i];
    else if (a === '--esforco') o.esforcoFixo = argv[++i];
    else if (a === '--preco-entrada') o.precoEntrada = Number(argv[++i]);
    else if (a === '--preco-saida') o.precoSaida = Number(argv[++i]);
    else if (a === '--ajuda' || a === '-h') o.ajuda = true;
  }
  return o;
}

/* ─────────────────────── os casos, e a conversa ─────────────────────── */

// Cada caso e uma sequencia de turnos. `contexto` e o bloco variavel do system
// naquele turno: quando ele muda entre turnos, a montagem "antes" perde o
// prefixo inteiro e a "depois" nao. E o coracao da medida.
function casos(projeto) {
  const ctxBase = (extra) => ''
    + '\n\nACTIVE AURORA PROJECT — single source of truth, refreshed every turn:\n'
    + `  project_root: ${projeto}\n`
    + `  spf_file:     ${projeto}\\proc.spf\n`
    + 'Use these exact paths when calling tools (read_file, create_file, set_top_level, …).\n'
    + 'Do not hallucinate a different root, do not assume cwd. If you need the full file list, call get_project_tree.\n'
    + (extra || '');

  return {
    // Compilar, ler o que o terminal disse, perguntar sobre o erro. O turno 3
    // acontece DEPOIS de instalar um componente: o contexto do projeto muda,
    // e e exatamente o evento que jogava fora os 10,4 mil tokens estaveis.
    compilacao: {
      nome: 'compilacao',
      turnos: [
        {
          rotulo: 'pede para compilar',
          operacao: 'livre',
          contexto: ctxBase(),
          mensagens: [{ role: 'user', content: 'Compile the project and tell me if it built.' }],
        },
        {
          rotulo: 'continuacao apos a compilacao falhar',
          operacao: 'posCompilacaoFalha',
          contexto: ctxBase(),
          mensagens: [
            { role: 'user', content: 'Compile the project and tell me if it built.' },
            { role: 'assistant', content: 'Starting the build in the background.' },
            {
              role: 'user',
              content:
                '[AUTONOMOUS BACKGROUND TASK] "compile all" (bg-medida) failed: exit code 1.\n\n'
                + 'Relevant terminal output (truncated):\n'
                + '{"tcmm":"cmm: erro na linha 42\\ncmm: erro na linha 51\\ncompilation aborted"}\n\n'
                + 'Summarise the outcome for the user concisely, and decide whether any follow-up action is warranted.',
            },
          ],
        },
        {
          rotulo: 'pergunta sobre o erro, ja com um componente novo instalado',
          operacao: 'livre',
          // O contexto MUDOU. Este e o turno que separa as duas montagens.
          contexto: ctxBase(
            '\nCOMPONENTS NOT INSTALLED:\n  icarus — simulador Verilog\n'
            + 'Do not call tools that depend on these.\n',
          ),
          mensagens: [
            { role: 'user', content: 'Compile the project and tell me if it built.' },
            { role: 'assistant', content: 'The build failed at line 42 of the C+- source.' },
            { role: 'user', content: 'Why does line 42 fail? The loop index is called i.' },
          ],
        },
      ],
    },

    // Abrir a onda e investigar um sinal. Conversa mais longa, contexto parado:
    // aqui as duas montagens deviam empatar, e empatar E o resultado esperado.
    // Se a nova perder neste caso, a separacao custou alguma coisa.
    onda: {
      nome: 'onda',
      turnos: [
        {
          rotulo: 'abre a onda',
          operacao: 'livre',
          contexto: ctxBase(),
          mensagens: [{ role: 'user', content: 'Open the waveform for the last simulation.' }],
        },
        {
          rotulo: 'pergunta sobre um sinal',
          operacao: 'livre',
          contexto: ctxBase(),
          mensagens: [
            { role: 'user', content: 'Open the waveform for the last simulation.' },
            { role: 'assistant', content: 'The waveform is open in the PRISM panel.' },
            { role: 'user', content: 'Does the write-enable of the register file ever go high before the first instruction fetch?' },
          ],
        },
        {
          rotulo: 'pede outro ponto de vista da mesma onda',
          operacao: 'livre',
          contexto: ctxBase(),
          mensagens: [
            { role: 'user', content: 'Open the waveform for the last simulation.' },
            { role: 'assistant', content: 'The waveform is open in the PRISM panel.' },
            { role: 'user', content: 'Does the write-enable of the register file ever go high before the first instruction fetch?' },
            { role: 'assistant', content: 'It stays low until cycle 7.' },
            { role: 'user', content: 'Group the datapath signals and show me the same window in hexadecimal.' },
          ],
        },
      ],
    },
  };
}

/* ─────────────────────── as duas montagens ─────────────────────── */

// Como a AURORA montava ate 13/09/2026: um bloco so, uma marca no fim dele.
// Replicado aqui (e nao importado) de proposito: o codigo antigo nao existe
// mais, e a comparacao precisa dele para ter contra o que medir.
function montarAntes({ system, systemContext, messages }) {
  const inteiro = (system || '') + (systemContext || '');
  return {
    instructionsArg: inteiro
      ? [{ role: 'system', content: inteiro, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } }]
      : undefined,
    messagesArg: messages,
  };
}

function montarDepois({ system, systemContext, messages }) {
  const r = promptCache.montarComCache({
    providerName: 'anthropic', system, systemVariavel: systemContext, messages,
  });
  return { instructionsArg: r.instructionsArg, messagesArg: r.messagesArg };
}

/* ─────────────────────── medida de estrutura ─────────────────────── */

function chars(instructionsArg) {
  if (!instructionsArg) return { blocos: 0, total: 0, marcados: 0 };
  const lista = Array.isArray(instructionsArg) ? instructionsArg : [{ content: instructionsArg }];
  let total = 0;
  let marcados = 0;
  for (const b of lista) {
    const n = String(b.content || '').length;
    total += n;
    if (b.providerOptions) marcados += n;
  }
  return { blocos: lista.length, total, marcados };
}

function relatorioEstrutural(system, casosDois) {
  console.log('\nESTRUTURA (sem rede, sao os bytes que vao no pedido)\n');
  console.log(`  system prompt estavel   ${system.length.toLocaleString('pt-BR')} chars`);
  console.log(`  ferramentas             ${tools.TOOL_MANIFEST.length} no manifesto, a ultima leva a marca de 1h`);
  console.log('');

  for (const caso of casosDois) {
    console.log(`  caso "${caso.nome}"`);
    let perdidoAntes = 0;
    let ctxAnterior = null;
    for (const t of caso.turnos) {
      const p = promptCache.proporcaoEstavel(system, t.contexto);
      const a = chars(montarAntes({ system, systemContext: t.contexto, messages: t.mensagens }).instructionsArg);
      const d = chars(montarDepois({ system, systemContext: t.contexto, messages: t.mensagens }).instructionsArg);
      const mudou = ctxAnterior !== null && ctxAnterior !== t.contexto;
      if (mudou) perdidoAntes += p.estavel;
      ctxAnterior = t.contexto;
      console.log(
        `    ${t.rotulo}`
        + `\n      system ${p.total.toLocaleString('pt-BR')} chars = ${p.estavel.toLocaleString('pt-BR')} estaveis (${p.pctEstavel}%) + ${p.variavel} por turno`
        + `\n      antes: ${a.blocos} bloco, ${a.marcados.toLocaleString('pt-BR')} chars sob a marca`
        + `  |  depois: ${d.blocos} blocos, ${d.marcados.toLocaleString('pt-BR')} chars sob a marca`
        + (mudou ? `\n      o contexto MUDOU neste turno: a montagem antiga reescreve os ${p.estavel.toLocaleString('pt-BR')} chars estaveis, a nova nao` : ''),
      );
    }
    if (perdidoAntes) {
      console.log(`    total reescrito a toa pela montagem antiga neste caso: ${perdidoAntes.toLocaleString('pt-BR')} chars`);
    }
    console.log('');
  }
}

function relatorioDeEsforco() {
  console.log('POLITICA DE ESFORCO (main/ai/effort_policy.js)\n');
  for (const [nome, linha] of Object.entries(effortPolicy.POLITICA)) {
    const v = linha.esforco === null ? '(o da interface)' : linha.esforco;
    console.log(`  ${nome.padEnd(20)} ${String(v).padEnd(16)} ${linha.porque}`);
  }
  console.log('');
  for (const ui of ['low', 'medium', 'high']) {
    console.log(`  com a interface em ${ui}: ${effortPolicy.linhagensDeCache(ui)} linhagens de cache a aquecer`);
  }
  console.log('\n  Cada linhagem e um prefixo proprio. Uma operacao rara numa linhagem so\n'
    + '  dela paga a escrita e quase nunca colhe a leitura: e o caso em que a\n'
    + '  linha tem de se justificar pelo raciocinio, e nao pelo cache.\n');
}

/* ─────────────────────── medida viva ─────────────────────── */

function equivalente(u) {
  // A conta em tokens de entrada equivalentes: quanto a entrada deste turno
  // custaria se tudo fosse token de entrada normal.
  return u.escritos * MULT.escrita1h + u.lidos * MULT.leitura + u.entrada * MULT.entrada;
}

function dinheiro(eq, saida, o) {
  if (o.precoEntrada == null) return null;
  const e = (eq / 1e6) * o.precoEntrada;
  const s = o.precoSaida != null ? (saida / 1e6) * o.precoSaida : 0;
  return e + s;
}

async function medirUmTurno({ modelo, esforco, instructionsArg, messagesArg, aiTools, ai, provedor }) {
  const t0 = Date.now();
  let ttft = null;
  const r = ai.streamText({
    model: provedor(modelo),
    messages: messagesArg,
    ...(instructionsArg ? { instructions: instructionsArg } : {}),
    ...(esforco ? { providerOptions: { anthropic: { effort: esforco } } } : {}),
    tools: aiTools,
    // Uma so passada: nao se quer que o modelo saia executando ferramenta, so
    // que o PEDIDO tenha o peso real. As ferramentas entram pelo tamanho.
    stopWhen: ai.stepCountIs(1),
    maxRetries: 1,
  });
  let texto = '';
  for await (const parte of r.textStream) {
    if (ttft === null) ttft = Date.now() - t0;
    texto += parte;
  }
  const usage = await r.totalUsage.catch(() => null) || await r.usage.catch(() => null);
  const cache = promptCache.leituraDoCache(usage);
  return {
    ttft,
    total: Date.now() - t0,
    lidos: cache.lidos,
    escritos: cache.escritos,
    entrada: cache.entrada,
    saida: Number(usage?.outputTokens ?? 0) || 0,
    chars: texto.length,
  };
}

function linha(rotulo, m, o) {
  const eq = equivalente(m);
  const d = dinheiro(eq, m.saida, o);
  return `    ${rotulo.padEnd(26)} `
    + `cache lidos ${String(m.lidos).padStart(7)}  escritos ${String(m.escritos).padStart(7)}  `
    + `cheios ${String(m.entrada).padStart(6)}  saida ${String(m.saida).padStart(5)}  `
    + `equiv ${String(Math.round(eq)).padStart(7)}  `
    + `ttft ${String(m.ttft ?? '-').padStart(5)} ms`
    + (d != null ? `  ${d.toFixed(6)} por chamada` : '');
}

async function medirVivo(system, casosDoze, o) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n--vivo precisa de ANTHROPIC_API_KEY no ambiente. A chave e lida dali e nao');
    console.error('e impressa, gravada nem mandada para lugar nenhum alem da propria API.\n');
    process.exitCode = 1;
    return;
  }
  let ai; let anthropic;
  try {
    ai = require('ai');
    anthropic = require('@ai-sdk/anthropic').anthropic;
  } catch (e) {
    console.error(`\nnao consegui carregar o SDK: ${e && e.message}\n`);
    process.exitCode = 1;
    return;
  }
  // As ferramentas de verdade, com a marca na ultima. O `execute` nunca roda
  // (uma passada so), mas o PESO delas no pedido e o real.
  const aiTools = tools.buildTools(async () => ({ ok: true }));

  const montagens = o.soEsforco
    ? [['depois', montarDepois]]
    : [['antes', montarAntes], ['depois', montarDepois]];
  const esforcos = o.soCache
    ? [['fixo ' + o.esforcoFixo, () => o.esforcoFixo]]
    : o.soEsforco
      ? [['fixo ' + o.esforcoFixo, () => o.esforcoFixo], ['pela politica', (t) => effortPolicy.esforcoPara(t.operacao, o.esforcoFixo)]]
      : [['fixo ' + o.esforcoFixo, () => o.esforcoFixo], ['pela politica', (t) => effortPolicy.esforcoPara(t.operacao, o.esforcoFixo)]];

  console.log(`\nMEDIDA VIVA — modelo ${o.modelo}`);
  if (o.precoEntrada == null) {
    console.log('  sem --preco-entrada: a conta sai em tokens de entrada equivalentes');
    console.log('  (escrita 1h = 2x, leitura = 0,1x, entrada cheia = 1x, da tabela da Anthropic)');
  }
  console.log('');

  for (const caso of casosDoze) {
    console.log(`  caso "${caso.nome}"`);
    for (const [nomeEsforco, escolher] of esforcos) {
      for (const [nomeMontagem, montar] of montagens) {
        console.log(`   esforco ${nomeEsforco}, montagem ${nomeMontagem}`);
        let somaEq = 0;
        for (const t of caso.turnos) {
          const { instructionsArg, messagesArg } = montar({
            system, systemContext: t.contexto, messages: t.mensagens,
          });
          try {
            const m = await medirUmTurno({
              modelo: o.modelo, esforco: escolher(t), instructionsArg, messagesArg, aiTools, ai, provedor: anthropic,
            });
            somaEq += equivalente(m);
            console.log(linha(t.rotulo.slice(0, 26), m, o));
          } catch (e) {
            console.log(`    ${t.rotulo.slice(0, 26).padEnd(26)} FALHOU: ${e && e.message}`);
          }
        }
        const dTotal = dinheiro(somaEq, 0, o);
        console.log(`    ${'—'.repeat(26)} soma equiv ${Math.round(somaEq).toLocaleString('pt-BR')}`
          + (dTotal != null ? `  ${dTotal.toFixed(6)} o caso inteiro` : ''));
      }
    }
    console.log('');
  }
  console.log('  As duas contas sao separadas de proposito. A montagem responde pelo cache;');
  console.log('  o esforco responde por quanto raciocinio a tarefa pediu. Juntas, uma esconde');
  console.log('  a outra: menos tokens com mais raciocinio pode dar a mesma fatura.\n');
}

/* ─────────────────────── principal ─────────────────────── */

function ajuda() {
  console.log(require('fs').readFileSync(__filename, 'utf8')
    .split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
}

async function main() {
  const o = argumentos(process.argv.slice(2));
  if (o.ajuda) { ajuda(); return; }

  const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'js', 'ai', 'system_prompt.js')).href);
  const system = mod.SYSTEM_PROMPT;

  const todos = casos('C:\\projetos\\proc');
  const escolhidos = o.caso === 'ambos' ? [todos.compilacao, todos.onda] : [todos[o.caso]];
  if (escolhidos.some((c) => !c)) {
    console.error(`caso desconhecido: ${o.caso} (use compilacao, onda ou ambos)`);
    process.exitCode = 1;
    return;
  }

  if (!o.soEsforco) relatorioEstrutural(system, escolhidos);
  if (!o.soCache) relatorioDeEsforco();
  if (o.vivo) await medirVivo(system, escolhidos, o);
  else console.log('  (--vivo mede tokens, cache e latencia de verdade; precisa de chave e gasta dinheiro)\n');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { argumentos, casos, montarAntes, montarDepois, chars, equivalente, MULT };
