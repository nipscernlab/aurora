
// Funcao sqrt para float em ponto fixo ---------------------------------------

@float_sqrti SET     sqrt_num                  // pega parametro
@L1_sqrti    SET     sqrt_x                    // atualiza x

             LOAD    sqrt_num                  // iteracao
             PLD     sqrt_x
             CALL    float_div
             PLD     sqrt_x
             CALL    denorm
             CALL    float_add
             PLD     3178496 // 0.5
             CALL    float_mult
             SET     sqrt_raiz

             PLD     float_nbits               // negacao da raiz
             SHL     1
             SADD                              // fim da negacao

             PLD     sqrt_x                    // x - raiz
             CALL    denorm
             CALL    float_add

             PLD     float_nbits               // abs(.)
             SHL     1
             INV
             SAND

             PLD     epsilon_taylor            // checa tolerancia
             CALL    denorm
             LOAD    float_aux3
             LES     float_aux1
             JZ      L2else_sqrti
             JMP     L1end_sqrti

@L2else_sqrti LOAD   sqrt_raiz                 // se nao eh, volta
              JMP    L1_sqrti

@L1end_sqrti LOAD    sqrt_raiz                 // se eh, retorna o resultado
             RETURN
