
// Funcao arco-tangente para float --------------------------------------------

@float_atan SET arctan_x          // pega parametro

ABS
LES 1.0                           // testa se esta entre -1 e 1
JZ at_L4else

LOAD 1.57079632679489661923       // carrega pi/2
SIGN arctan_x                     // coloca o sinal de x em pi/2

PLD arctan_x                      // chama recursivo com 1/x (se abs(x) > 1)
DIV 1.0
CALL float_atan

NEG                               // subtrai o resultado de pi/2 com sinal
SADD
RETURN                            // retorna

@at_L4else LOAD arctan_x          // salva x em termo
SET arctan_termo

LOAD arctan_x                     // calcula x^2
MLT arctan_x
SET arctan_x2

LOAD arctan_termo                 // salva termo em resultado
SET arctan_resultado

LOAD arctan_x2                    // calcula a tolerancia
DIV epsilon_taylor
SET arctan_tolerancia

LOAD 3                            // inicializa indice com 3
SET arctan_indiceX

@at_L5 LOAD arctan_termo          // inicio: testa se abs(termo) > tolerancia
ABS
PLD arctan_tolerancia
SGRE
JZ at_L5end

LOAD -2                           // calculo principal: termo = termo * (- x2 * (indiceX - 2)) / indiceX;
ADD arctan_indiceX
MLT arctan_x2
NEG
MLT arctan_termo
PLD arctan_indiceX
SDIV
SET arctan_termo

ADD arctan_resultado              // atualiza o resultado
SET arctan_resultado

LOAD 2                            // atualiza o indice
ADD arctan_indiceX
SET arctan_indiceX
JMP at_L5                         // e volta

@at_L5end LOAD arctan_resultado   // fim
RETURN
