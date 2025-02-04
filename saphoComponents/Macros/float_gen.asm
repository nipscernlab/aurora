
// Empacota numero ------------------------------------------------------------

@float_pack  LOAD    0                       // se for zero
             EQU     float_aux3              // carrega zero e sai
             JZ      floatL1else
             LOAD    float_zero
             RETURN

@floatL1else LOAD    0                       // separa mantissa
             SET     float_aux4              // no MSB e
             LOAD    nbexpp1                 // reseta shift
             SHL     float_aux3
             SET     float_aux3

@floatL2     LES     0                       // checa se MSB ja eh 1
             JZ      floatL2end
             LOAD    1                       // se nao, soma 1 no shift
             ADD     float_aux4
             SET     float_aux4
             LOAD    1                       // e shifta a mantissa
             SHL     float_aux3              // pra esquerda
             SET     float_aux3
             JMP     floatL2

@floatL2end  LOAD    float_nbits             // empacota
             SHL     float_aux1
             PLD     float_aux4
             MLT     -1
             ADD     float_aux2
             PLD     nbmantp1
             SSHL
             PLD      1
             SSHR
             SADD
             PLD     float_aux3
             PLD     nbexpp1
             SSHR
             SADD
@floatL1end  RETURN

// Separa expoente ------------------------------------------------------------

@get_exp     PLD     1
             SSHL
             PLD     nbmantp1
             SSRS
             SET     float_aux2
             RETURN

// Equaliza expoente de 2 numeros ---------------------------------------------

@denorm      SETP    float_aux3              // pega parametros
             SET     float_aux1

             PLD     float_nbits             // pega sinal 1
             SSHR
             SET     denormsig_a

             LOAD    float_nbits             // pega sinal 2
             SHR     float_aux3
             SET     denormsig_b

             LOAD    float_aux1              // pega expoente 1
             CALL    get_exp
             SET     denormexp_a

             LOAD    float_aux3              // pega expoente 2
             CALL    get_exp
             SET     denormexp_b

             LOAD    nbexpp1                 // pega mantissa 1
             SHL     float_aux1
             PLD     nbexpp1
             SSHR
             SET     float_aux1

             LOAD    nbexpp1                 // pega mantissa 2
             SHL     float_aux3
             PLD     nbexpp1
             SSHR
             SET     float_aux3

             LOAD    denormexp_b             // subtrai os expoentes
             PLD     denormexp_a
             MLT     -1
             SADD
             SET     float_aux4

             LOAD    denormexp_b             // se exp 1 menor q exp 2 ...
             LES     denormexp_a
             JZ      floatL4else

             LOAD    float_aux4              // shifta pela diferenca ...
             SHR     float_aux1
             SET     float_aux1

             LOAD    denormexp_b
             SET     float_aux2
             JMP     floatL4end

@floatL4else LOAD    float_aux3
             PLD     float_aux4
             MLT     -1
             SSHR
             SET     float_aux3

             LOAD    denormexp_a
             SET     float_aux2

@floatL4end  LOAD    denormsig_a
             JZ      floatL5else
             LOAD    float_aux1
             MLT     -1
             SET     float_aux1

@floatL5else LOAD    denormsig_b
             JZ      floatL6else
             LOAD    float_aux3
             MLT     -1
             SET     float_aux3

@floatL6else RETURN
