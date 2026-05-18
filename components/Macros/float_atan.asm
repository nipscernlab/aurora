
// Arctangent function --------------------------------------------------------

#arrays atan_lut 2 49 "$Arctan_LUT.txt"

@float_atan SET   atan_x

         PF_ABS_M atan_x          // test whether to use x or 1/x
          F_LES   1.0
            JIZ   L_atan

          F_ABS_M atan_x          // 1/x branch
          F_DIV   47.0
            SET   atan_idxf       // compute position in x

            F2I
            SET   atan_idx        // take the first index

            LDI   atan_lut
            SET   atan_x          // take the first y value from the table

            LOD   atan_idx
            ADD   1
            LDI   atan_lut        // take the second y value from the table

          F_SU1   atan_x          // perform the linear interpolation
          P_I2F_M atan_idx
          F_SU2   atan_idxf
         SF_MLT
          F_ADD   atan_x

          F_ADD  -1.57079632679   // offset for the 1/x branch

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