
// Funcao sqrt ----------------------------------------------------------------

@float_sqrti SET     sqrt_num                  // pega parametro
@L1_sqrti    SET     sqrt_x                    // atualiza x

             F_DIV   sqrt_num                  // iteracao
             F_ADD   sqrt_x
             F_MLT   0.5
             SET     sqrt_raiz

             F_NEG                              // negacao da raiz
             F_ADD   sqrt_x                    // x - raiz

             F_GRE   epsilon_taylor            // checa tolerancia
             JIZ     L2else_sqrti

             LOD     sqrt_raiz                 // se eh, retorna o resultado
             RET

@L2else_sqrti LOD    sqrt_raiz                 // se nao eh, volta
              JMP    L1_sqrti
