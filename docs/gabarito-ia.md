# Gabarito da Aurora Intelligence

Perguntas para fazer à IA no painel da Aurora depois de cada versão, e o que a resposta certa precisa ter. Os testes de unidade conferem o texto que a IA recebe (`js/ai/system_prompt.ts`), mas não conferem se ela raciocina bem com ele. Este gabarito cobre essa parte. Leva uns 20 minutos.

Como usar: abra um projeto de teste vazio, faça as perguntas em conversas novas, e marque o que falhou. Uma falha quase sempre aponta uma frase errada ou ausente no prompt, nas descrições das ferramentas (`main/ai/tools.js`) ou no `resources/sapho_rules.json`. Corrija lá e prenda a correção com um caso em `tests/unit/ai_system_prompt.test.js`.

Os fatos abaixo valem para o yanc v9.1. Quando o `YANC_TAG` mudar, revise o gabarito junto com o prompt (o teste dos padrões cai sozinho e lembra).

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
Certo: desde o v8.0 a divisão inteira leva cinco palavras, `DIV x; NOP; NOP; NOP; QUO` (`MOD x; NOP; NOP; NOP; REM`), e a de float quatro, `F_DIV x; NOP; NOP; F_QUO`, e o mesmo nas formas de pilha, porque o divisor tem cinco e quatro estágios. Cita a mensagem ("DIV leva 5 palavras: depois dela vêm 3 NOP e a leitura do resultado") e reescreve com a sequência. Diz que em C± e C++ o compilador escreve isso sozinho, e que um .asm da v6.0 a v7.1 (`DIV x; NOP; QUO`) não monta mais.
Errado: tirar um `NOP` ao otimizar, ensinar a sequência de três palavras (era a da v6.0 à v7.1), ou dizer que QUO é uma instrução nova com opcode próprio (é apelido do DIV).

**13. "Meu processador divide. Qual relógio ele aguenta na placa?"**
Certo: o divisor deixou de limitar o relógio no v6.0, e no v8.0 o `sapho_all` foi de 21,8 para 32,4 MHz na DE10-Nano e de 23,5 para 37,3 MHz na ZYBO, com a mesma área (média de três sementes). O número do projeto dele sai da síntese, e o limite real na placa ainda depende da varredura. Lembra que `SAPHO/` e `asmcomp` têm de ser da mesma release.
Errado: sugerir uns 10 MHz para quem divide (era o caso até o v5.7), citar os 21,9 MHz do v6.0 como atuais, ou prometer frequência sem síntese.

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

**19. "Meu `while (erro)` em C± para antes de o erro zerar. Por quê?"**
Certo: antes do v8.0 o C± convertia o float para inteiro truncando, então todo valor entre -1 e 1 era falso. Desde o v8.0 a condição float testa a mantissa, como no C, e o laço só para no zero; basta recompilar com o yanc atual. Custa uma palavra e um ciclo por condição float.
Errado: mandar escrever `while (erro != 0.0)` ou `while (erro > 1e-6)` como contorno, ou dizer que em C++ toda condição float é verdadeira (era assim antes do v8.0).

**20. "Quero ler um teclado PS/2 no meu processador."**
Certo: usa o bloco `SAPHO/myKeyPS2.v` ao lado do processador, no top-level, e lê cada tecla com `c = cade_sync(k)` (ou `cade(k)` com o bloco em outro clock). Diz que ele entrega um caractere pronto por tecla apertada (Shift e a tabela ficam no hardware; Enter vira 10), com `LAYOUT` "ABNT2" por padrão, e mostra a ligação: `ps2_clk` e `ps2_dat` do teclado, `taqui -> taqui_k`, `dado -> cade_dado_k`, `cade <- cade_k`. Um processador de 8 bits basta. Desde o v9.1, sabe que Ctrl com uma letra dá o código de controle (Ctrl+A = 1) e que a saída `tem_tecla`, ligada numa porta de `in()`, deixa o programa perguntar se há tecla sem ficar preso no `cade_sync`.
Errado: decodificar o scancode no programa, ler o teclado por `in()`, ou prometer setas, F1-F12 e `ç`, que o bloco não entrega.

**21. "Meu processador só usa inteiros. Configure 16 bits."**
Certo: escreve `#NUBITS 16` e não precisa de `#NBMANT` nem `#NBEXPO`, porque desde o v9.0 a regra `NUBITS = NBMANT + NBEXPO + 1` só vale para programa com float.
Errado: exigir mantissa e expoente que somem 15, ou dizer que sem eles o asmcomp recusa (era assim até o v8.0).

**22. "Quero escrever texto num monitor VGA."**
Certo: usa o bloco `SAPHO/myVGAText.v` ao lado do processador e escreve cada caractere com `toma_sync(k, c)` (ou `toma(k, c)` em outro clock). Diz que é uma tela de 80 x 30 caracteres, que 10 muda de linha, 8 apaga, 128 limpa e 129 seguido de linha e coluna põe o cursor, e que o clock do bloco é o de pixel, 25 MHz. Mostra a ligação (`toma <- toma_k`, `dado <- toma_dado`, `valeu -> valeu_k`, e `hs`, `vs`, `ativo` e `pixel` para o conversor da placa) e, na DE2-115, as duas formas do `VGA_CLK`: `~clk`, que o manual do yanc recomenda e ainda não foi visto em placa, e `clk`, que funcionou num projeto anterior na placa.
Errado: gerar o sincronismo VGA no programa, ou dizer que não há bloco de vídeo (era assim até o v9.0).

**23. "Como leio um número do teclado e escrevo na tela em C++?"**
Certo: `#include <iostream>`, `cin >> n` e `cout << ...`, com o teclado no link 0 e a tela no link 1, no clock do processador; sem `cade_sync` nem `toma_sync` no programa. Se for ler uma linha depois de um número, lembra do `cin.ignore(100, '\n')`. Outros links vão por `#define YANC_STDIN_LINK` e `YANC_STDOUT_LINK` antes do primeiro `#include`.
Errado: `printf`, `scanf`, `std::string` ou `std::getline(cin, s)`, que ainda não existem, decodificar scancode, ou dar a uma variável o nome `hex` ou `cout`.

**24. "Monte na DE2-115 um sistema com o teclado e a tela."**
Certo: um relógio só, um PLL de 50 para 25 MHz, com o SAPHO, o `myKeyPS2` e o `myVGAText` nele, falando com `cade_sync` e `toma_sync`; reset `~KEY[0] | ~locked`; o `.sdc` com `create_clock` de 20 ns no `CLOCK_50`, `derive_pll_clocks` e `derive_clock_uncertainty`; `PS2_CLK` e `PS2_DAT` como entrada; a pinagem da placa (`CLOCK_50` em Y2, `PS2_CLK` em G6, `VGA_CLK` em A12, as cores, e o resto); e diz que o PLL ainda não rodou em placa.
Errado: inventar número de pino, rodar o SAPHO a 50 MHz com o `myVGAText` sem PLL, ou declarar `PS2_CLK` e `PS2_DAT` como bidirecionais. Pedida a mesma coisa para outra placa, o certo é pedir o arquivo de pinos dela, e não inventar.

**25. Forma, em qualquer resposta acima**
Responde em português quando a pergunta é em português; código sempre em bloco com a linguagem marcada; referências a arquivo no formato `arquivo.cmm:linha`; sem travessão, sem emoji, sem "ótima pergunta".
