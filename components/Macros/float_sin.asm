
// Sine function --------------------------------------------------------------

#arrays sin_LUT 2 152 "$Sin_LUT.txt"

@float_sin      SET   sin_x                 // save x

@L_sin        F_ABS_M sin_x                 // check whether x < pi
              F_LES   3.141592653589793     // compare on magnitude for float
                JIZ   L_sin_end

                LOD   6.283185307           // otherwise, keep subtracting 2pi
              F_SGN   sin_x
              F_SU2   sin_x
                SET   sin_x
                JMP   L_sin

@L_sin_end    F_ABS_M sin_x                 // method starts here

              F_MLT   47.746482927568       // multiply by 150.0/pi to find the position in x
                SET   sin_idxf              // save into idxf

                F2I                         // round the index down
                SET   sin_idx               // save into idx

                LDI   sin_LUT               // fetch the matching data in the table
                SET   sin_v                 // save into v

                LOD   sin_idx               // fetch the next index
                ADD   1                     // could be INC_M sin_idx

                LDI   sin_LUT               // fetch the matching data in the table

              F_SU1   sin_v                 // subtract from v

              P_I2F_M sin_idx               // get the slope of the line
              F_SU2   sin_idxf

             SF_MLT                         // compute the value on the line

              F_ADD   sin_v                 // add the offset v

              F_SGN   sin_x                 // apply the sign and return
                RET
