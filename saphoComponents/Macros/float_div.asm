
// Funcao divide --------------------------------------------------------------

@float_div SETP  divb             // pega parametros
           SET   diva

           PLD   nbexpp1          // pega mantissa 1
           SSHL
           PLD   1
           SSHR
           SET   float_aux1

           LOAD  nbexpp1          // pega mantissa 2
           SHL   divb             // mas coloca ela com menos bit
           PLD   nbexp            // pra fazer a divisao em ponto fixo
           ADD   nbexp
           SSHR
           SET   float_aux2

           DIV   float_aux1       // divide as mantissas
           SET   float_aux3       // coloca o resultado em no aux3

           LOAD  float_nbits      // pega o sinal da divisao
           SHR   diva
           PLD   float_nbits
           SHR   divb
           SADD
           SET   float_aux1       // coloca o resultado em aux1

           LOAD  diva             // subtrai os expoentes
           CALL  get_exp
           PLD   divb
           CALL  get_exp
           MLT   -1
           SADD

           PLD   nbexp            // ajusta expoente
           MLT   -1
           SADD
           ADD    1
           PLD   nbexp
           MLT   -1
           SADD
           SET   float_aux2

           CALL  float_pack       // empacota e sai
           RETURN
