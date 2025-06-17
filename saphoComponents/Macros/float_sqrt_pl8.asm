
// Funcao sqrt ----------------------------------------------------------------

@float_sqrt     SET sqrt_num       // pega parametro
@L1_sqrt        SET sqrt_x         // atualiza x

                CAL float_inv      // iteracao
              F_MLT sqrt_num
                NOP
                NOP
                NOP
                NOP
              F_ADD sqrt_x
                NOP
                NOP
                NOP
                NOP
                NOP
              F_MLT 0.5
                NOP
                NOP
                NOP
                NOP
                SET sqrt_raiz

              F_NEG                // negacao da raiz
              F_ADD sqrt_x         // x - raiz
                NOP
                NOP
                NOP
                NOP
                NOP

              F_GRE epsilon_taylor // checa tolerancia
                NOP
                NOP
                NOP
                JIZ L2else_sqrt 

                LOD sqrt_raiz      // se eh, retorna o resultado
                RET

@L2else_sqrt    LOD sqrt_raiz      // se nao eh, volta
                JMP L1_sqrt
