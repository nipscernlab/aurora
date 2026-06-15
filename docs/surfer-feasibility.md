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

## 10. Layout files + picker + janela (14/06/2026, parte 2)

Verdade-de-campo do binário v0.7.0 (`surfer --help` + fonte): **não há flag de maximizar** nem
`with_maximized`; o `-s`/state **não** guarda geometria de janela; o config local `.surfer/` é
**quebrado no Windows** (walk-up com limite `/`). Geometria só pelo config global
`%APPDATA%\surfer-project\surfer\config\config.toml` `[layout] window_*` (pontos lógicos). E
`surfer <vcd> -s <state>`: o **VCD posicional tem precedência** sobre o `source` embutido no state, e
os itens **re-resolvem por nome/caminho** (IDs `Wellen` são descartados) → um `.surf.ron` salvo é
**portável** entre re-runs/paths. Entregue nesta parte:

- **Escolher/registrar layout do Surfer como um `.gtkw`:** `WaveStore.surferFiles[]` (espelha
  `gtkwFiles[]`, por testbench) + 6 AI-tools `list/find/use/add/set_active/remove_surfer_file`
  (`aurora_api.js` + `tools.js`, aceitam `.surf.ron`/`.sucl`).
- **Picker viewer-aware:** o mesmo dropdown da toolbar (`gtkw_picker.js`) lê `getViewer()` e alterna
  entre `gtkwFiles`/`surferFiles` (e o filtro do dialog) — escuta `aurora:wave-viewer-changed`.
- **Launch com layout:** `_waveResolveSurferSaveFile()` (Source 1, o entry `isActive`) →
  `_waveLaunchSurfer(vcd, layout)` monta `surfer <vcd> -s <.surf.ron>` ou `-c <.sucl>`.
- **Janela centralizada adaptativa:** `writeSurferCenteredWindowConfig()` (`main/ipc/compile.js`) lê
  o work-area real (`screen`, nada hardcoded), escreve um retângulo centralizado a ~85% no config
  global do Surfer (marker-guarded p/ não sobrescrever config do usuário); o usuário maximiza. Sem
  "maximizar de verdade" porque o Surfer não suporta.

**Deferido (follow-up):** `buildSurferLayout()` auto-gerando o layout curado da seleção do picker —
**entregue na §11**; embed por iframe WASM; e o pre-pass do `comp2gtkw` (Fase 3). Tudo isolado em
`_waveLaunchSurfer`/`_waveResolveSurferSaveFile`.

---

## 11. Auto-geração do layout curado — `.surf.ron` (14/06/2026, parte 3)

Pesquisa source-level (v0.7.0) + **verificação adversarial** mostraram que o command-file `.sucl` é
**frágil/lossy** pra curadoria: `item_set_color/format` mira o item *focado* e `variable_add` não
foca → exige `item_focus` por um índice **base-16 minúsculo zero-padded** (erra silencioso);
`divider_add` aceita **só 1 palavra**; **não há** multi-seleção (grupos curados impossíveis); e
**não há** format token analógico. Decisão: **gerar `.surf.ron` (state declarativo)**, não `.sucl`.

Validado de campo: gerei um `.surf.ron` pelo emissor com **IDs `Wellen` propositalmente errados** e o
usuário **carregou no Surfer** — sinais, cores, formatos, `manual_name`, `height_scaling_factor` e
`analog` corretos. Confirma o formato **e** a re-resolução por nome.

- **`js/wave/surfer_layout_writer.ts`** — duas camadas:
  - `buildSurferState(items)` = camada de FORMATO: emite RON válido a partir de uma lista ordenada de
    `{variable|divider|timeline}`. `items_tree` (ordem visual) + `displayed_items` (mapa por ref);
    IDs `Wellen` placeholder. Casca externa = defaults estáveis do `UserState`.
  - `buildSurferLayout(input)` = camada de CURADORIA: espelha `buildAuroraGtkw` (reusa
    `detectProcessors`/`resolveScopeModules`/`buildSignedSet` **verbatim**), mesma ordem de seções e
    seleção. Mapeia `FMT_*`→translator (`Binary`/`Unsigned`/`Signed`/`FP: 32-bit IEEE 754`/`Hexadecimal`),
    cores (`Orange`/`Yellow`/`Violet`), aliases→`manual_name`, e **recupera o analógico** (`analog`)
    nos stack pointers/ULA que o `.sucl` perdia.
- **Source 2** em `_waveResolveSurferSaveFile(simTopModule, vcdFile, tempBaseDir)`: sem `.surf.ron`
  ativo do usuário, auto-gera via `buildSurferLayout` (mesma seleção do picker / `_parseProjectSources`)
  e escreve `<tempBaseDir>/<simTopModule>.surf.ron`. 14 unit tests novos.

**Ainda deferido (v2):** os **mapping translators** das trilhas Assembly/linha-fonte
(`trad_opcode.txt`/`trad_cmm.txt` → `.surfer/mappings/` no config dir, `format: <nome>`) — hoje `valr2`
(`Assembly`) e `linetabs` (`C+-`) abrem em **decimal cru** (igual ao GTKWave sem os trad files). O
decode de mnemônico/linha-fonte tem o risco de **descoberta do mapping no Windows** (config global vs
`.surfer/` local quebrado) a validar em campo. Complexo (`comp2gtkw`) degrada pra `Binary`.

---

## 12. Estado atual + retomar daqui (fim de 14/06/2026)

> Resumo auto-contido pra continuar de outro computador (só o repo). Branch
> `feature/aurora-revamp` (remote `origin`).

### Pronto e no repo (commits desta integração)
| Commit | Entrega | Seção |
|---|---|---|
| `2a343ee` | Surfer como **viewer opt-in**: toggle na toolbar (`#viewerSwitch`), preferência (`viewer_preference.js`), API da IA (`get/set_waveform_viewer`), branch de launch (`_waveLaunchSurfer` + IPC `launch-surfer` + fallback GTKWave). | §9 |
| `a9f3337` | **Layout files escolhíveis como `.gtkw`**: `WaveStore.surferFiles[]`, 6 AI-tools (`list/find/use/add/set_active/remove_surfer_file`), picker viewer-aware, launch `-s`/`-c`, **janela centralizada adaptativa**. | §10 |
| `115c329` | **Auto-geração do layout curado `.surf.ron`** (`buildSurferLayout`), Source 2 em `_waveResolveSurferSaveFile`, 14 unit tests. | §11 |

**Estado funcional:** com **Surfer** selecionado no toggle, o botão Wave abre **curado** (seções,
cores, formatos, aliases, analógico). O binário não é bundlado — o usuário coloca
`components/Packages/surfer/surfer.exe` (sem ele → fallback GTKWave). Já instalado/testado em campo.

### Retomar daqui — v2 (próxima tarefa): mapping translators (decode Assembly / linha-fonte)
Hoje `valr2` (alias "Assembly") e `linetabs` ("C+-") abrem em **decimal cru**. O decode mnemônico/
linha-fonte usa o **mapping translator** do Surfer:
1. `Temp/<procType>/trad_opcode.txt` e `trad_cmm.txt` **já** estão no formato `valor texto`
   (decimal→string) que o Surfer aceita — só falta um header `Name = <nome>` no topo.
2. Escrever cada um em `<config>/mappings/<nome>`. **RISCO a validar primeiro:** no Windows o
   `.surfer/mappings/` local (cwd) é **quebrado** (walk-up com limite POSIX `/`), então provavelmente
   vai no config global `%APPDATA%\surfer-project\surfer\config\mappings\`. **Validar igual ao formato**:
   pôr um mapping lá na mão, abrir o Surfer, e confirmar que vira um translator selecionável.
3. Em `buildSurferLayout` (`buildInstructions`), trocar `format:'Unsigned'`/`'Signed'` de valr2/linetabs
   por `format:'<nome do mapping>'` (1 nome por procType). Retornar a lista `{name, srcPath}` e copiar
   via um IPC novo (espelha `writeSurferCenteredWindowConfig` em `main/ipc/compile.js`).

**Arquivos:** `js/wave/surfer_layout_writer.ts` (buildInstructions + retorno `mappings`),
`js/compilation/compilation_module.js` (`_waveResolveSurferSaveFile`), `main/ipc/compile.js` (IPC de
escrita dos mappings).

### Depois (v3+)
- **Complexo** (`comp_me3_*`/`comp_arr_me3_*`): `comp2gtkw.exe` não tem equivalente nativo no Surfer
  (nenhum translator roda processo externo) → pre-pass reusando o `.exe` (fonte em
  `yanc/Scripts/comp2gtkw.c`); hoje degrada pra `Binary`.
- **Grupos colapsáveis reais** (arrays/Stack/ULA): o `.surf.ron` suporta via `items_tree` com
  `level>0` + nó `Group`, mas o sample testado não tinha grupo — **falta confirmar a serialização**
  (hoje usamos `divider` como cabeçalho de seção, sem fold).
- **Embed WASM por iframe** (viewer dentro da IDE) — Fase grande, ver §6/§7.

### Descobertas-chave (validadas no fonte v0.7.0 + em campo) — não re-derivar
- `surfer <vcd> -s <state.surf.ron>`: o **VCD da CLI vence** o `source` embutido; itens **re-resolvem
  por nome/caminho** (IDs `Wellen` = só dica) → state **portável**. CONFIRMADO em campo (gerado com IDs
  errados de propósito, carregou certo).
- `.sucl` (command file) é **frágil/lossy** pra curadoria → geramos `.surf.ron` declarativo (§11).
- Surfer **não tem "maximizar"** — janela só via config global `[layout] window_width/height/x/y`
  (pontos lógicos). Centralizamos a ~85% lendo a tela real (`screen`); o usuário maximiza.
- Cores: `Green/Red/Yellow/Blue/Pink/Orange/Gray/Violet`. Formato = nome do translator
  (`Hexadecimal/Unsigned/Signed/Binary/FP: 32-bit IEEE 754/ASCII/...`). Alias = `manual_name`.
  Analógico = campo `analog: Some((settings: (render_style: Step|Interpolated, y_axis_scale: ...)))`.
- **Binário:** baixar de
  `https://gitlab.com/api/v4/projects/42073614/packages/generic/surfer/v0.7.0/surfer_win_v0.7.0.zip`,
  extrair **`surfer.exe`** (≠ `surver.exe`, o helper) pra `components/Packages/surfer/`. Build do
  fonte: `cargo install --git https://gitlab.com/surfer-project/surfer.git surfer` (Rust ≥1.92 + MSVC
  Build Tools). EUPL-1.2: só obriga incluir a `LICENSE-EUPL-1.2.txt` ao **redistribuir** o binário
  bundlado; `spawn` arm's-length **não contamina** a AURORA.

### Como testar / verificação
Toggle **Surfer** → **Wave** num projeto SAPHO (sem `.surf.ron` ativo no picker → auto-gera Source 2).
Cadência da sessão: `npm run build:ts` · `npx eslint --max-warnings=0` · `npm run build:renderer` ·
`npm test` (222 unit) · e2e `vitest run --config vitest.config.e2e.js` (7/8 — o flaky pré-existente
`split-pane > PRISM open-at-line` não tem relação).
