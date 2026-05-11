
// Funcao arco-tangente -------------------------------------------------------

#arrays atan_lut 2 49 "$Arctan_LUT.txt"

@float_atan SET   atan_x

         PF_ABS_M atan_x          // testa se vai usar x ou 1/x
          F_LES   1.0
            JIZ   L_atan

          F_ABS_M atan_x          // branch de 1/x
          F_DIV   47.0
            SET   atan_idxf       // calcula posicao em x

            F2I
            SET   atan_idx        // pega primeiro indice

            LDI   atan_lut
            SET   atan_x          // pega primeiro valor y na tabeka

            LOD   atan_idx
            ADD   1
            LDI   atan_lut        // pega segundo valor y na tabela

          F_SU1   atan_x          // faz a interpolacao linear
          P_I2F_M atan_idx
          F_SU2   atan_idxf
         SF_MLT
          F_ADD   atan_x

          F_ADD  -1.57079632679   // offset do branch 1/x

         SF_SGN
            RET

@L_atan   F_ABS_M atan_x
          F_MLT   47.0
            SET   atan_idxf

            F2I
            SET   atan_idx

            LDI   atan_lut
            SET   atan_x

            LOD   atan_idx
            ADD   1
            LDI   atan_lut
            
          F_SU1   atan_x
          P_I2F_M atan_idx
          F_SU2   atan_idxf
         SF_MLT
          F_ADD   atan_x

         SF_SGN
            RET