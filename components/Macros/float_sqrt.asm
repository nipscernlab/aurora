
// Funcao sqrt ----------------------------------------------------------------

@float_sqrt     SET sqrt_num       // pega parametro
              F_ROT                // primeira estimativa (potencia de 2 mais proxima)
              
                PSH                // atualiza x
              F_DIV sqrt_num       // iteracao
             SF_ADD 
              F_MLT 0.5

                PSH                // atualiza x
              F_DIV sqrt_num       // iteracao
             SF_ADD
              F_MLT 0.5

                PSH                // atualiza x
              F_DIV sqrt_num       // iteracao
             SF_ADD
              F_MLT 0.5

                PSH                // atualiza x
              F_DIV sqrt_num       // iteracao
             SF_ADD
              F_MLT 0.5

                RET