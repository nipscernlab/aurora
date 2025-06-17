
// Funcao divisao por inteiro -------------------------------------------------

@int_div         SET_P divide_den    // int int_div(int num, int den)
                 SET   divide_num

                 LOD   1             // int sig = sign(num,1)*den;
                 SGN   divide_num
                 MLT   divide_den
                 NOP
                 SET   divide_sig

                 ABS_M divide_num    // num = abs(num);
                 SET   divide_num

                 ABS_M divide_den    // den = abs(den);
                 SET   divide_den

                 LOD   0             // int result = 0;
                 SET   divide_result

                 LOD   0             // int shift = 0;
                 SET   divide_shift

                 LOD   divide_den    // int dens = den;
                 SET   divide_dens

@L4_int_div      LOD   0             // while ((dens > 0) && (dens <= num))
                 GRE   divide_dens
                 NOP
               P_LOD   divide_num
                 GRE   divide_dens
                 NOP
                 LIN
                 NOP
                 NOP
               S_LAN
                 NOP
                 NOP
                 JIZ   L4end_int_div

                 LOD   divide_shift  // shift++;
                 ADD   1
                 NOP

                 SET   divide_shift  // dens = den << shift;
                 LOD   divide_shift
                 SHL   divide_den
                 NOP
                 SET   divide_dens

                 JMP   L4_int_div    // } (while)

@L4end_int_div   NEG_M 1             // shift = shift - 1;
                 ADD   divide_shift
                 NOP
                 SET   divide_shift

@L5_int_div      LOD   0             // while (shift >= 0)
                 LES   divide_shift
                 NOP
                 LIN
                 NOP
                 NOP
                 JIZ   L5end_int_div

                 LOD   divide_shift  // dens = den << shift;
                 SHL   divide_den
                 NOP
                 SET   divide_dens

                 LOD   divide_num    // if (dens <= num)
                 GRE   divide_dens
                 NOP
                 LIN
                 NOP
                 NOP
                 JIZ   L6else_int_div

                 NEG_M divide_dens   // num = num - dens;
                 ADD   divide_num
                 NOP
                 SET   divide_num

                 LOD   divide_shift  // result = result + (1 << shift);
                 SHL   1
                 NOP
                 ADD   divide_result
                 NOP
                 SET   divide_result

@L6else_int_div  NEG_M 1             // shift = shift-1;
                 ADD   divide_shift
                 NOP
                 SET   divide_shift

                 JMP   L5_int_div    // } (while)

@L5end_int_div   LOD   divide_result // return sign(sig, result);
                 SGN   divide_sig
                 RET
