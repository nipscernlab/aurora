# Gabarito da Aurora Intelligence

Perguntas para fazer à IA no painel da Aurora depois de cada versão, e o que a resposta certa precisa ter. Os testes de unidade conferem o texto que a IA recebe (`js/ai/system_prompt.ts`), mas não conferem se ela raciocina bem com ele. Este gabarito cobre essa parte. Leva uns 15 minutos.

Como usar: abra um projeto de teste vazio, faça as perguntas em conversas novas, e marque o que falhou. Uma falha quase sempre aponta uma frase errada ou ausente no prompt, nas descrições das ferramentas (`main/ai/tools.js`) ou no `resources/sapho_rules.json`. Corrija lá e prenda a correção com um caso em `tests/unit/ai_system_prompt.test.js`.

Os fatos abaixo valem para o yanc v5.6. Quando o `YANC_TAG` mudar, revise o gabarito junto com o prompt (o teste dos padrões cai sozinho e lembra).

## Perguntas

**1. "Crie um processador chamado media, com uma entrada e uma saída."**
Certo: cria pela ferramenta de processador, e o `.cmm` nasce com sete diretivas (`#PRNAME media`, `#NUBITS`, `#NBMANT`, `#NBEXPO`, `#NUIOIN 1`, `#NUIOOU 1`, `#NUGAIN`).
Errado: escrever `#NDSTAC` ou `#SDEPTH` sem você pedir.

**2. "Quais diretivas o cabeçalho de um .cmm precisa ter?"**
Certo: as sete acima; `#NDSTAC` e `#SDEPTH` são opcionais e normalmente ficam de fora; `#FFTSIZ` e `#FROUND` também são opcionais. Diz que faltar uma diretiva não dá erro de build: o compilador usa o padrão (32 bits, mantissa 23, expoente 8) sem avisar.
Errado: dizer que são nove obrigatórias, ou que a falta dá erro.

**3. "Posso usar #NUGAIN 100?"**
Certo: não. No v5.6 o cmmcomp e o asmcomp recusam valor que não seja potência de 2 e o build para. O motivo é o divisor de verdade que a ULA precisaria.
Errado: dizer que compila e só custa hardware (era verdade antes do v5.6).

**4. "Por que meu processador ficou com pilhas de 128?"**
Certo: sem `#NDSTAC`/`#SDEPTH`, o yanc v5.6 usa 128; a partir do próximo yanc a profundidade é calculada pelo programa; para fixar agora, escreva a diretiva.
Errado: inventar outra causa, ou dizer que o padrão é 10 ou 5.

**5. "Quero a pilha de dados fixa em 8."**
Certo: acrescenta `#NDSTAC 8` no cabeçalho e não mexe no resto.

**6. "Configure 16 bits com mantissa de 10 bits."**
Certo: faz a conta `NUBITS = NBMANT + NBEXPO + 1` e chega em `#NBEXPO 5`. Sabe que essa equação, se errada, só falha na etapa do asmcomp.

**7. "Compile e simule o projeto."**
Certo: confere antes que o projeto tem topo e testbench declarados, e usa as ferramentas na ordem do fluxo. Se faltar algo, diz o quê.

**8. "Crie um processador em C++ chamado filtro."**
Certo: um `.cpp` com só três pragmas (`#pragma yanc prname filtro`, `nuioin`, `nuioou`) e `void main(void)`.
Errado: acrescentar pragmas de largura, ganho ou pilhas que você não pediu.

**9. "Quem mantém a Aurora?"**
Certo: o Prof. Luciano.

**10. Forma, em qualquer resposta acima**
Responde em português quando a pergunta é em português; código sempre em bloco com a linguagem marcada; referências a arquivo no formato `arquivo.cmm:linha`; sem travessão, sem emoji, sem "ótima pergunta".
