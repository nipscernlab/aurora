
// Funcao int2float -----------------------------------------------------------

@int2float   SET    int2floata           // salva parametro

             PLD    float_nbits          // pega sinal
             SSHR
             SET    float_aux1

             LOAD   0                    // inicializa com zero
             SET    float_aux2           // mas acho q nao serve pra nada

             LOAD   float_aux1           // testa o sinal ...
             JZ     floatL8else

             LOAD   int2floata           // se for 1 faz o complemento a 2
             MLT    -1
             SET    int2floata

@floatL8else LOAD   int2floata           // empacota
             SET    float_aux3
             CALL   float_pack
             RETURN
