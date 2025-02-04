
// Funcao multiplica ----------------------------------------------------------

@float_mult SETP   multb                    // pega parametros
            SET    multa

            LOAD   nbmant
            PLD    float_nbits
            ADD     1
            PLD     1
            SSHR
            MLT    -1
            SADD
            SET    float_aux4

            LOAD   nbexpp1                  // separa mantissa 1
            SHL    multa
            PLD    nbexpp1
            SSHR
            PLD    float_aux4
            SSHR
            SET    float_aux1

            LOAD   nbexpp1                  // separa mantissa 2
            SHL    multb
            PLD    nbexpp1
            SSHR
            PLD    float_aux4
            ADD     1
            SSHR
            SET    float_aux2

            MLT    float_aux1               // multiplica as mantissas
            SET    float_aux3

            LOAD   float_nbits
            SHR    multa
            PLD    multb
            PLD    float_nbits
            SSHR
            SADD
            SET    float_aux1

            LOAD   multa                    // pega exp 1
            CALL   get_exp
            PLD    float_aux4
            SADD

            PLD    multb                    // pega exp 2
            CALL   get_exp
            SADD
            PLD    float_aux4
            SADD

            PLD     1                       // soma os expoentes
            SADD
            PLD    nbexp
            SADD
            SET    float_aux2

            LOAD   nbexp
            SHR    float_aux3
            SET    float_aux3

            CALL   float_pack
            RETURN
