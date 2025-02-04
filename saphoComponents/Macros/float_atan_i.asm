
// Funcao arco-tangente para proc ponto fixo ----------------------------------

@float_atani SET arctan_x         // pega parametro

AND 4194303                       // zera o bit de sinal (abs pra float em software)

PLD 3244032 // 1.0                // testa se abs(x) < 1
CALL denorm
LOAD float_aux3
GRE float_aux1
JZ L4else

LOAD arctan_x                     // coloca o sinal de x em pi/2
AND 4194304
ADD pi_div_2

PLD 3244032 // 1.0                // chama recursivo com 1/x (se abs(x) > 1)
PLD arctan_x
CALL float_div
CALL float_atani

PLD float_nbits                   // negacao em ponto flutuante
SHL 1
SADD                              // fim da negacao

CALL denorm                       // subtrai o resultado de pi/2 com sinal
CALL float_add
RETURN                            // retorna

@L4else LOAD arctan_x             // salva x em termo
SET arctan_termo

LOAD arctan_x                     // calcula x^2
PLD arctan_x
CALL float_mult
SET arctan_x2

LOAD arctan_termo                 // salva termo em resultado
SET arctan_resultado

LOAD epsilon_taylor               // calcula a tolerancia
PLD arctan_x2
CALL float_div
SET arctan_tolerancia

LOAD 3                            // inicializa indice com 3
SET arctan_indiceX

@L5 LOAD arctan_termo             // inicio: testa se abs(termo) > tolerancia
AND 4194303                       // zera o bit de sinal (abs pra float em software)
PLD arctan_tolerancia
CALL denorm
LOAD float_aux3
GRE float_aux1
JZ L5end

LOAD -2                           // calculo principal: termo = termo * (- x2 * (indiceX - 2)) / indiceX;
ADD arctan_indiceX
CALL int2float
PLD arctan_x2
CALL float_mult
PLD float_nbits                   // negacao em ponto flutuante
SHL 1
SADD                              // fim da negacao
PLD arctan_termo
CALL float_mult
PLD arctan_indiceX
CALL int2float
CALL float_div
SET arctan_termo

LOAD arctan_resultado             // atualiza o resultado
PLD arctan_termo
CALL denorm
CALL float_add
SET arctan_resultado

LOAD 2                            // atualiza o indice
ADD arctan_indiceX
SET arctan_indiceX
JMP L5                            // e volta

@L5end LOAD arctan_resultado      // fim
RETURN
