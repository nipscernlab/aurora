
// Funcao soma ----------------------------------------------------------------

@float_add   LOAD   float_aux1        // soma as mantissas
             PLD    float_aux3
             SADD
             SET    float_aux3

             PLD    float_nbits
             SSHR
             SET    float_aux1        // seta o sinal

             LOAD   float_aux2
             ADD     1
             SET    float_aux2

             LOAD   float_aux1
             JZ     floatL7else       // se o sinal for um ...

             LOAD   float_aux3        // faz o complemento a 2
             MLT    -1
             SET    float_aux3

@floatL7else LOAD   float_aux3
             PLD     1
             SSHR
             SET    float_aux3

             CALL   float_pack        // empacota
             RETURN
