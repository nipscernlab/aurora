# Estudo de viabilidade — Surfer no lugar do GTKWave (backlog §13.H · O1)

> **Veredito:** VIÁVEL, com **um único gap real** (`comp2gtkw`, decodificação de números
> complexos) → recomendação **PHASED-GO**, idealmente **em paralelo com o GTKWave** (o usuário
> escolhe qual usar) até a paridade ser provada.
> Fundamentado por um workflow de 3 agentes (mapa da integração GTKWave em AURORA+YANC · pesquisa
> web do Surfer · veredito cruzado feature-a-feature). Data: 2026-06-14.

---

## 1. Resumo executivo

O Surfer é um waveform viewer open-source (Rust + egui, backend `wellen`), publicado como tool paper
no CAV 2025, financiado pela NLnet. Ele lê **VCD/FST nativamente** (FST é o formato do próprio
GTKWave) e foi **feito pra ser embutido** (build WASM num `<iframe>`/webview). Esse é o grande ganho:
hoje o GTKWave é uma **janela externa** `gtkwave.exe` que a IDE vigia com um poll de 2s; com o Surfer
as ondas ficariam **dentro da AURORA**.

Das três "pilastras" da curadoria YANC que o GTKWave mostra, **duas mapeiam direto** no Surfer, e a
view curada inteira (o `.gtkw`) re-expressa de forma mecânica. **Só uma** feature — a decodificação de
números complexos do `comp2gtkw` — não tem casa nativa no Surfer e é o eixo de ~60% do esforço/risco.

---

## 2. Como o AURORA usa o GTKWave hoje

- **Launch:** `gtkwave.exe` **externo, destacado** (`detached`), spawnado pelo main
  (`main/ipc/compile.js:45-91`, handler `launch-gtkwave-only`) a partir de
  `compilation_module.js:_waveLaunchGtkwave()` (3772-3805). Um poll de 2s
  (`compilation_module.js:223-251`) detecta quando fecha pra voltar à file-tree.
- **O AURORA já gera o `.gtkw` ele mesmo** — `buildAuroraGtkw()` em `js/wave/gtkw_proc_writer.ts:818-925`
  (chamado de `_waveResolveGtkwSaveFile()`, `compilation_module.js:3502-3640`). **Não** depende do
  `gen_gtkw` do YANC. Isso é ótimo: a lógica de curadoria (detecção de processador, grupos, formatos,
  aliases) é TypeScript nosso e pode ser re-apontada pro formato do Surfer.
- **Translators do YANC** (gerados pelos compiladores em `Temp/<procType>/`):
  - `trad_opcode.txt` (ASMComp, `yanc/Compilers/ASMComp/Sources/simulacao.c:172`): tabela
    **decimal → "opcode operando"** (`0 LDI 5`, `1 ADD 3`…). Vira a **trilha de Assembly** (valr2).
  - `trad_cmm.txt` (CMMComp): tabela **decimal → linha-fonte .cmm**. Vira a **trilha C±** (linetabs).
  - Ambos anexados ao `.gtkw` como **file filters** (`^N <path>`).
  - `comp2gtkw.exe` (`yanc/Scripts/comp2gtkw.c`): **process filter** (`^>N <path>`) que decodifica
    números complexos pra `"%.3f %.3fi"`.
- **Dump:** VCD/FST da simulação + um `.header.vcd` (só `$scope/$var`, extraído por `fst2vcd.exe` em
  `_extractFstHeaderVcd()`, `compilation_module.js:2189-2263`) usado pelo picker.

**Dependências duras:** lookup int→string por arquivo (assembly/linha-fonte), o filtro de processo
externo (complexos), o formato `.gtkw`, a detecção multi-processador, e o parse do header VCD.

---

## 3. O que o Surfer oferece

- **Formatos:** VCD, FST, GHW (GHW menos completo) via `wellen` (leitura preguiçosa → rápido em traces
  grandes no nativo). **FST = formato do GTKWave**, então o dump não muda.
- **Embedding (o ganho):** build **WASM** oficial; embute via `<iframe>` apontando pra um bundle local
  (offline-friendly), controlado por `postMessage` (`assets/integration.js`) + o **WCP** (Waveform
  Control Protocol, estilo LSP, sobre TCP/stdio ou JSON no webview).
- **Translators (config, sem recompilar):**
  - **mapping translator** = arquivo texto `valor → string` (`0b0001 State 1`, radix livre, cores por
    entrada). **É exatamente o lookup int→string** que as trilhas de assembly/linha-fonte precisam — o
    `trad_opcode.txt`/`trad_cmm.txt` já estão nesse formato.
  - **decoder TOML** (crate `instruction-decoder`) = decodifica encodings por fatias de bits **fixas**
    → texto. **Não** faz aritmética nem largura-de-campo dependente de dados (ver §5).
- **View curada (= `.gtkw`):** três vias — arquivo de **estado** (`-s`), **command file** `.sucl`
  (`--command-file`: `variable_add`, `item_set_format`, `item_set_color`, `group_marked`,
  `divider_add`, `item_rename`, `item_focus`…), ou **WCP ao vivo** (a IDE re-dirige a view).
  *Nuance verificada:* o **WCP não seta formato** — os translators têm que ir pelo `.sucl` no launch.

---

## 4. Matriz de paridade (feature a feature)

| Feature YANC/GTKWave | Surfer | Status |
|---|---|---|
| Load VCD/FST | `wellen` (FST nativo) | ✅ paridade — artefato idêntico, sem mudança |
| Embutir na IDE | iframe WASM + postMessage/WCP | ✅ **melhor** (hoje é janela externa) |
| Trilha de Assembly (valr2 + `trad_opcode.txt`) | **mapping translator** (já é a tabela certa) | ✅ paridade |
| Trilha de linha-fonte (linetabs + `trad_cmm.txt`) | mapping translator (idêntico) | ✅ paridade |
| Variáveis vivas (int/float) | formatos built-in + `group_marked`/`divider_add` | ✅ paridade |
| **Números complexos (`comp2gtkw`)** | sem filtro externo; config não faz aritmética | ❌ **GAP** (ver §5) |
| View curada (`.gtkw`) | `.sucl` command file (ou estado, ou WCP) | ✅ paridade (mais rica) |
| Multi-processador | detecção fica no AURORA → grupos `.sucl` | ✅ paridade |
| Navegação IDE↔ondas | WCP (`set_viewport_to` ao clicar numa linha) | ✅ **bônus** (GTKWave nunca deu) |

---

## 5. O único gap real: `comp2gtkw` (números complexos)

`comp2gtkw.c` lê um encoding **auto-descritivo e de largura variável** (os primeiros 16 bits dizem a
largura da mantissa/expoente, que então determinam os campos real/imaginário), reconstrói dois floats
(`m·2^e`, com sinal-magnitude no expoente) e imprime `"%.3f %.3fi"`. Verificado contra o código do
`instruction-decoder`: o decoder TOML **só** fatia bits **fixos** e renderiza/lookup — **sem
aritmética, sem largura dependente de dados**. E o Surfer **não tem** o escape hatch do GTKWave (o
filtro de processo externo `^>N exe`). Logo, `comp2gtkw` **não** é expressável em mapping nem decoder.

**Soluções (em ordem de preferência):**
1. **Pre-pass (recomendado, sem forkar):** rodar o **`comp2gtkw.exe` que JÁ existe** *antes*, sobre os
   sinais complexos extraídos do dump, e **assar** os strings `a+bi` decodificados num mapping file /
   sinal-string num VCD aumentado que o Surfer mostra direto. Reusa o binário do YANC, respeita a
   licença, não toca no Surfer.
2. **Reconstruir o `comp2gtkw` como `Translator` em Rust** num fork do Surfer. Mais "nativo", mas adiciona
   build do fork + obrigação EUPL-1.2 + manutenção de rebase. **Temos o fonte C em
   `C:\Users\chrys\Documents\GitHub\yanc\Scripts\comp2gtkw.c`** pra portar a lógica — então é factível,
   só mais caro que o pre-pass.

---

## 6. Riscos

### 6.1 Licença EUPL-1.2 — por que (quase) NÃO é problema pra nós

- **O que é:** *European Union Public Licence v1.2* — licença **copyleft** (recíproca), aprovada pela
  OSI/Comissão Europeia. Obriga: ao **distribuir** o software ou um **derivado**, disponibilizar o
  fonte sob a EUPL (ou uma licença compatível — a EUPL tem cláusula de compatibilidade com GPLv2/v3,
  AGPL, MPL, EPL, etc.). Tem gatilho tipo-AGPL (disponibilizar por rede também conta como distribuição).
- **Por que NÃO trava a gente:**
  1. **Já bundlamos o GTKWave, que é GPL** (copyleft igual/mais forte). Trocar um viewer copyleft por
     outro copyleft **não muda nossa postura de licença** em nada.
  2. **Embutir ≠ derivar.** Rodar o Surfer como **processo/binário separado** ou num **iframe WASM**
     (comunicando por IPC/postMessage/WCP) é **agregação arms-length**, não linking — a AURORA **não**
     vira obra derivada. Só **redistribuímos** o binário/WASM do Surfer sob EUPL (incluir a LICENSE +
     apontar pro fonte público no GitLab).
  3. **A AURORA/SAPHO já é open-source** (repos nipscernlab). Mesmo a obrigação de "abrir derivados"
     não é um custo — já abrimos tudo.
  4. **O único caso que cria obrigação real** é **forkar o Surfer** (mexer no Rust — ex.: o Translator
     de complexos da opção 2 do §5). Aí o **fork** (não a AURORA) tem que ter o fonte publicado sob
     EUPL — o que, pra um projeto OSS acadêmico, é trivial (publicar o fork no GitLab/GitHub).
- **Conclusão:** a flag da licença no estudo era **due diligence**, não bloqueio. Pra bundlar o Surfer
  sem modificar: incluir a LICENSE dele. Pra forkar: publicar o fork. Nada disso afeta a licença da
  AURORA. (Só vale checar com quem cuida da licença SAPHO antes de bundlar, por formalidade.)

### 6.2 Outros riscos
- **Performance do WASM em traces grandes** — o build web é mais lento que o nativo. Mitigação: pra
  traces pesados, rodar o **binário nativo** dirigido por **WCP via TCP** (perde o iframe, ganha
  performance).
- **WCP/embed imaturos** — "early/unstable", já há comandos deprecados. **Pinar uma versão.**
- **Maturidade** — Surfer ~2.5 anos vs GTKWave 20+; algumas conveniências de análise do GTKWave podem
  não ter equivalente ainda.

---

## 7. Caminho de migração — **em paralelo, opt-in** (recomendado)

A AURORA **já tem o precedente**: o toggle de simulador (`get_simulator`/`set_simulator` →
iverilog/verilator). Um **toggle de viewer** (`gtkwave` | `surfer`) é o mesmo padrão. Assim os dois
**coexistem** e o usuário escolhe — **risco zero**, GTKWave continua o default provado, Surfer é opt-in
pra teste.

- **Fase 0 — Spike (sem refactor):** bundlar o Surfer WASM local; escrever à mão 1 `.sucl` + mapping
  pra **um testbench YANC real**; confirmar trilhas de opcode/linha-fonte + grouping num iframe.
  *(Opcionalmente já prototipar o pre-pass do `comp2gtkw` — mas pode ser adiado, ver §8.)*
- **Fase 1 — Preferência + emissão:** adicionar a preferência de viewer (como o simulador); um
  `buildSurferLayout()` irmão do `buildAuroraGtkw()` (reusa `detectProcessors`/`resolveProcPaths`
  **verbatim**) que emite os mapping files (derivados dos mesmos `trad_*.txt`) + o `.sucl`.
- **Fase 2 — Launch/lifecycle:** `launch-gtkwave-only` ganha um irmão `launch-surfer` (iframe embutido
  ou `surfer.exe --command-file <.sucl>` nativo); swap do poll de 2s pelo evento de load/close do
  iframe (ou exit do processo). **Branch por preferência** — o caminho GTKWave fica intacto.
- **Fase 3 — `comp2gtkw`** (o gap, ver §5) — pre-pass reusando o `.exe` existente.
- **Fase 4 — WCP ao vivo (opcional):** clicar numa linha `.cmm` → pula o waveform (capacidade nova).

O grosso do código de wave (detecção de processador, header, picker, WaveStore) é **viewer-agnóstico**
e sobrevive sem mudança.

---

## 8. Recomendação

**PHASED-GO, em paralelo.** Implementar o Surfer **ao lado** do GTKWave, escolhível por toggle —
exatamente como iverilog/verilator. Pra um **MVP rápido**, dá pra **ignorar os números complexos** de
início (sinais complexos degradam pra binário cru, igual ao GTKWave sem o `comp2gtkw`): tudo o mais
(trilhas de assembly/linha-fonte, view curada, embedding, multi-proc) mapeia limpo, então o MVP é
basicamente um **re-encode mecânico + embed por iframe**. Depois reconstruímos o `comp2gtkw` (temos o
fonte C em `yanc/Scripts/comp2gtkw.c`) via pre-pass. **Não** deletar o caminho GTKWave até a paridade
ser provada em testbenches reais.

**Arquivos-chave:** `js/wave/gtkw_proc_writer.ts` (irmão `buildSurferLayout`), `js/compilation/
compilation_module.js` (`_waveResolveGtkwSaveFile`, `_waveLaunchGtkwave`, `monitorGtkwaveProcess`),
`main/ipc/compile.js` (launch + kill). Pinar uma versão do Surfer. Incluir a LICENSE EUPL ao bundlar.

---

## 9. Implementação — MVP entregue (14/06/2026)

O **toggle paralelo** (a recomendação §8) está implementado e validado (lint + build + 208 unit +
e2e 7/8, com o flaky pré-existente do PRISM). O usuário já consegue **escolher** o Surfer e a IA já
tem **API** pra trocar o viewer. Entregue:

- **Preferência** `js/wave/viewer_preference.js` (`getViewer`/`setViewer`, localStorage
  `aurora.waveViewer`, default `gtkwave`) — espelha `simulator_preference.js`.
- **Toggle na toolbar** `js/wave/viewer_toggle.js` + `#viewerSwitch` no `index.html` (dois segmentos
  Phosphor: `ph-wave-square` = GTKWave, `ph-wave-sine` = Surfer; CSS reusa `.sim-seg`).
- **API da IA** `AuroraAPI.wave.getViewer/setViewer` (`js/api/aurora_api.js`) + tools
  `get_waveform_viewer`/`set_waveform_viewer` (`main/ai/tools.js`, enum `gtkwave|surfer`).
- **Branch de launch** em `_runWave` (`compilation_module.js:1895`): `getViewer()==='surfer'` →
  `_waveLaunchSurfer`, senão o caminho GTKWave **intacto**. `_waveResolveToolchain` resolve
  `surferBin` (`components/Packages/surfer/surfer.exe`).
- **IPC** `launch-surfer` (`main/ipc/compile.js`): mesmo contrato detached do `launch-gtkwave-only`,
  mas com `existsSync` → not-found limpo; `trackChild` garante teardown no fechamento da IDE.

**Degradação graciosa:** o `surfer.exe` **ainda não é bundlado**, então hoje a escolha por Surfer
abre o **VCD cru** no `surfer.exe` se ele existir, ou avisa no terminal e **cai pro GTKWave** (o botão
Wave nunca fica sem viewer). Basta dropar o binário em `components/Packages/surfer/` pra ativar.

**Deferido (follow-up):** Fase 1 plena — `buildSurferLayout()` emitindo o `.sucl` curado + mapping
files dos `trad_*.txt` (hoje o MVP abre o VCD sem curadoria); embed por iframe WASM; e o pre-pass do
`comp2gtkw` (Fase 3). A separação viewer-agnóstica deixa isso isolado em `_waveLaunchSurfer`.
