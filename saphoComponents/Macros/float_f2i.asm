
// Funcao float2int -----------------------------------------------------------

@float2int    SET   float2inta      // salva parametro

              PLD   1               // pega expoente e
              SSHL                  // coloca em float_aux2
              PLD   nbmantp1
              SSRS
              SET   float_aux2

              LOAD  float2inta
              PLD   nbexpp1         // pega modulo da mantissa
              SSHL                  // e coloca em float_aux3
              PLD   nbexpp1
              SSHR
              SET   float_aux3

              LOAD  0               // testa sinal do expoente
              LES   float_aux2

              JZ    floatL9else     // se expoente eh negativo,
              LOAD  float_aux3      // shifta mantissa pra direita
              PLD   float_aux2
              MLT   -1
              SSHR
              SET   float_aux3

              JMP   floatL9end      // se expoente eh positivo,
@floatL9else  LOAD  float_aux3      // shifta mantissa pra esquerda
              PLD   float_aux2
              SSHL
              SET   float_aux3

@floatL9end   LOAD  float2inta      // testa bit de sinal da mantissa
              PLD   float_nbits
              SSHR

              JZ    floatL10else    // se bit de sinal eh um,
              LOAD  float_aux3      // negativa a mantissa
              MLT   -1
              SET   float_aux3

@floatL10else LOAD  float_aux3
              RETURN
