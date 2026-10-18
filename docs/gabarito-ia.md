# Gabarito da Aurora Intelligence

Perguntas para fazer à IA no painel da Aurora depois de cada versão, e o que a resposta certa precisa ter. Os testes de unidade conferem o texto que a IA recebe (`js/ai/system_prompt.ts`), mas não conferem se ela raciocina bem com ele. Este gabarito cobre essa parte. Leva uns 20 minutos.

Como usar: abra um projeto de teste vazio, faça as perguntas em conversas novas, e marque o que falhou. Uma falha quase sempre aponta uma frase errada ou ausente no prompt, nas descrições das ferramentas (`main/ai/tools.js`) ou no `resources/sapho_rules.json`. Corrija lá e prenda a correção com um caso em `tests/unit/ai_system_prompt.test.js`.

Os fatos abaixo valem para o yanc v7.1. Quando o `YANC_TAG` mudar, revise o gabarito junto com o prompt (o teste dos padrões cai sozinho e lembra).

## Perguntas

**1. "Crie um processador chamado media, com uma entrada e uma saída."**
Certo: cria pela ferramenta de processador, e o `media/media.cmm` nasce com cinco diretivas (`#NUBITS`, `#NBMANT`, `#NBEXPO`, `#NUIOIN 1`, `#NUIOOU 1`). O nome do processador é o nome do arquivo.
Errado: escrever `#PRNAME`, que desde o v7.1 é erro de compilação, ou `#NDSTAC`, `#SDEPTH` e `#NUGAIN 128` sem você pedir.

**2. "Quais diretivas o cabeçalho de um .cmm precisa ter?"**
Certo: as cinco acima; `#NDSTAC` e `#SDEPTH` são opcionais e normalmente ficam de fora, porque o compilador calcula a profundidade pelo programa; `#NUGAIN` (padrão 128), `#FFTSIZ` e `#FROUND` também são opcionais. Não há `#PRNAME`: o nome é o do arquivo. Diz que faltar uma diretiva não dá erro de build: o compilador usa o padrão (32 bits, mantissa 23, expoente 8) sem avisar.
Errado: dizer que são nove obrigatórias, ou que a falta dá erro.

**3. "Posso usar #NUGAIN 100?"**
Certo: não. Desde o v5.6 o cmmcomp e o asmcomp recusam valor que não seja potência de 2 e o build para. O motivo é o divisor de verdade que a ULA precisaria.
Errado: dizer que compila e só custa hardware (era verdade antes do v5.6).

**4. "Por que meu processador ficou com pilhas de 128?"**
Certo: ou o programa tem recursão em C++ (aí a conta não fecha e fica 128, e o asmcomp avisa por quê), ou a diretiva foi escrita com 128. Sem diretiva e sem recursão, a pilha sai do tamanho que o programa usa (o pico + 1, no mínimo 2), e o terminal TASM mostra "Info: stack depths from the program".
Errado: dizer que 128 é o padrão de quem não declara (era assim até o v5.6), ou que o padrão é 10 ou 5.

**5. "Quero a pilha de dados fixa em 8."**
Certo: acrescenta `#NDSTAC 8` no cabeçalho e não mexe no resto.

**6. "Configure 16 bits com mantissa de 10 bits."**
Certo: faz a conta `NUBITS = NBMANT + NBEXPO + 1` e chega em `#NBEXPO 5`. Sabe que essa equação, se errada, só falha na etapa do asmcomp.

**7. "Compile e simule o projeto."**
Certo: confere antes que o projeto tem topo e testbench declarados, e usa as ferramentas na ordem do fluxo. Se faltar algo, diz o quê.

**8. "Crie um processador em C++ chamado filtro."**
Certo: um `filtro/filtro.cpp` com só dois pragmas (`nuioin`, `nuioou`) e `void main(void)`.
Errado: escrever `#pragma yanc prname`, que desde o v7.1 é erro, ou acrescentar pragmas de largura, ganho ou pilhas que você não pediu.

**9. "Quem mantém a Aurora?"**
Certo: o Prof. Luciano.

**10. "Posso fazer uma função recursiva em C±?"**
Certo: não. Desde o v5.7 é erro de compilação ("a função 'fact' chama ela mesma ... Recursão não rola em C±"), porque cada variável local tem endereço fixo. Reescreva como laço, ou passe o processador para C++, que aceita recursão.
Errado: dizer que compila, ou escrever a função recursiva em C±.

**11. "Apareceu 'Info: 3 unreachable instructions removed' no terminal. É erro?"**
Certo: não. Desde o v5.7 o compilador tira o código que nada alcança (função que ninguém chama, header sem uso) e avisa quantas instruções saíram. Não custa instrução, operador nem memória.

**12. "Escrevi um .asm à mão com `DIV x` seguido de `SET y` e o asmcomp deu erro. Por quê?"**
Certo: desde o v6.0 a divisão leva três palavras, `DIV x; NOP; QUO` (`MOD x; NOP; REM`, `F_DIV x; NOP; F_QUO`, e o mesmo nas formas de pilha), porque o resultado sai do divisor dois ciclos depois. Cita a mensagem ("DIV leva três palavras: depois dela vem NOP e a leitura do resultado") e reescreve com a sequência. Diz que em C± e C++ o compilador escreve isso sozinho.
Errado: tirar o `NOP` ao otimizar, ou dizer que QUO é uma instrução nova com opcode próprio (é apelido do DIV).

**13. "Meu processador divide. Qual relógio ele aguenta na placa?"**
Certo: desde o v6.0 o divisor não limita mais o relógio; no `sapho_all` passou de 9,43 para 21,9 MHz na DE10-Nano e de 8,80 para 23,98 MHz na ZYBO (um fit por placa, sem pinos). O número do projeto dele sai da síntese, e o limite real na placa ainda depende da varredura. Lembra que `SAPHO/` e `asmcomp` têm de ser da mesma release.
Errado: sugerir uns 10 MHz para quem divide (era o caso até o v5.7), ou prometer frequência sem síntese.

**14. "Crie um processador chamado meu-filtro."**
Certo: avisa que o nome vira o módulo Verilog e por isso só aceita letras ASCII, dígitos e `_` (sem dígito nem `__` no começo, e nenhuma palavra reservada do Verilog), e propõe `meu_filtro`.
Errado: criar com hífen, acento ou um nome como `wire`.

**15. "Onde fica o .v do meu processador filtro?"**
Certo: na pasta de saída que o yanc cria, `filtro/filtro/filtro.v`, junto com o `.asm`, os `.mif` e o `filtro_tb.v`. O fonte e os `input_N.txt` ficam em `filtro/`. Não escreve nada à mão dentro de `filtro/filtro/`.
Errado: falar de `Software/`, `Hardware/` ou `Simulation/`, que deixaram de existir no v7.1.

**16. "Quero renomear o processador filtro para fir."**
Certo: usa a ferramenta de renomear processador, que troca a pasta, o fonte e a pasta de saída juntos; não mexe no texto do fonte.
Errado: renomear só o `.cmm`, ou procurar uma diretiva de nome para trocar.

**17. "Quero que o processador a mande um valor para o b."**
Certo: usa `toma(k, x)` em a e `cade(k)` (ou `fcade(k)`) em b, no mesmo número de link; diz que quem chega primeiro espera, que os dois precisam do mesmo `#NUBITS` (e da mesma mantissa e expoente, para float) porque o yanc não confere, e mostra a ligação no top-level (`a.toma_k -> b.taqui_k`, `b.cade_k -> a.valeu_k`, `a.toma_dado -> b.cade_dado_k`). Oferece as formas `_sync` só se os dois estiverem no mesmo clock.
Errado: passar o valor por porta de saída e entrada, ou misturar `toma` com `cade_sync` no mesmo link.

**18. "Monte no Surfer uma vista com o clock e a saída do processador."**
Certo: confere os nomes com a lista de sinais da onda e cria um `.surf.ron` pela ferramenta de layout do Surfer, com o caminho completo de cada sinal (`tb.dut....`).
Errado: escrever um `.sucl`, ou passar comandos do Surfer em vez da lista de sinais.

**19. Forma, em qualquer resposta acima**
Responde em português quando a pergunta é em português; código sempre em bloco com a linguagem marcada; referências a arquivo no formato `arquivo.cmm:linha`; sem travessão, sem emoji, sem "ótima pergunta".
