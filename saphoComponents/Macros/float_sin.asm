
// Funcao seno ----------------------------------------------------------------

#arrays sin_LUT 2 152 "$Sin_LUT.txt"

@float_sin      SET   sin_x                 // salva x

@L_sin        F_ABS_M sin_x                 // checa se x < pi
              F_LES   3.141592653589793     // fazer menor em modulo pra float
                JIZ   L_sin_end

                LOD   6.283185307           // se nao for, vai subtraindo 2pi
              F_SGN   sin_x
              F_NEG
              F_ADD   sin_x
                SET   sin_x
                JMP   L_sin

@L_sin_end    F_ABS_M sin_x                 // aqui comeca o metodo

              F_MLT   47.746482927568       // multiplica por 150.0/pi pra achar a posicao em x
                SET   sin_idxf              // salva em idfx

                F2I_M sin_idxf              // arredonda o indice pra baixo
                SET   sin_idx               // salva em idx

                LDI   sin_LUT               // pega o dado correspondente na tabela
                SET   sin_LUT_v             // salva em v

                LOD   sin_idx               // pega o proximo indice
                ADD   1                     // fazer INC_M sin_idx

                LDI   sin_LUT               // pega o dado correspondente na tabela

             PF_NEG_M sin_LUT_v             // subtrai de v
             SF_ADD

              P_NEG_M sin_idx               // pega a inclinacao da reta
                I2F
              F_ADD   sin_idxf
             
             SF_MLT                         // acha o valor na reta

              F_ADD   sin_LUT_v             // soma com o offset v

              F_SGN   sin_x                 // pega o sinal e sai
                RET
