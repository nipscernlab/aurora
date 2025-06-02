
// Funcao arco-tangente -------------------------------------------------------

@float_atan                 SET   my_atan_x              // pega parametro x

                            EQU   0.0                    // if (x == 0) return 0.0;
                            NOP
                            JIZ   L1else_atan
                            LOD   0.0
                            RET

@L1else_atan              F_ABS_M my_atan_x              // if (abs(x) == 1.0) return sign(x,pi2*0.5);
                            EQU   1.0
                            NOP
                            JIZ   L2else_atan
                            LOD   1.57079632679489661923 // pi/2
                          F_MLT   0.5
                            NOP
                            NOP
                            NOP
                            NOP
                          F_SGN   my_atan_x
                            RET
                            JMP   L2end_atan

@L2else_atan              F_ABS_M my_atan_x              // else if (abs(x) > 1.0) return sign(x,pi2) - atan(1.0/x);
                          F_LES   1.0
                            NOP
                            NOP
                            NOP
                            JIZ   L3else_atan
                            LOD   1.57079632679489661923 // pi/2
                          F_SGN   my_atan_x
                          P_LOD   my_atan_x
                            CAL   float_inv
                          F_MLT   1.0
                            NOP
                            NOP
                            NOP
                            NOP
                            CAL   float_atan
                          F_NEG
                         SF_ADD
                            NOP
                            NOP
                            NOP
                            NOP
                            NOP
                            RET

@L3else_atan @L2end_atan    LOD   my_atan_x              // float termo = x;
                            SET   my_atan_termo

                            LOD   my_atan_x              // float x2 = x*x;
                          F_MLT   my_atan_x
                            NOP
                            NOP
                            NOP
                            NOP
                            SET   my_atan_x2

                            LOD   my_atan_termo          // float resultado = termo;
                            SET   my_atan_resultado

                            LOD   my_atan_x2             // float tolerancia = epslon/x2;
                            CAL   float_inv
                          F_MLT   epsilon_taylor
                            NOP
                            NOP
                            NOP
                            NOP
                            SET   my_atan_tolerancia

                            LOD   3                      // int indiceX = 3;
                            SET   my_atan_indiceX

@L4_atan                  F_ABS_M my_atan_termo          // while (abs(termo) > tolerancia)
                          F_LES   my_atan_tolerancia
                            NOP
                            NOP
                            NOP
                            JIZ   L4end_atan

                            LOD   -2                     // termo = termo * (- x2 * (indiceX - 2)) / indiceX;
                            ADD   my_atan_indiceX
                            NOP
                            I2F
                            NOP
                            NOP
                          F_MLT   my_atan_x2
                            NOP
                            NOP
                            NOP
                            NOP
                          F_NEG
                          F_MLT   my_atan_termo
                            NOP
                            NOP
                            NOP
                            NOP
                          P_I2F_M my_atan_indiceX
                            NOP
                            NOP
                            CAL   float_inv
                         SF_MLT
                            NOP
                            NOP
                            NOP
                            NOP
                            SET   my_atan_termo

                            LOD   my_atan_resultado      // resultado = resultado + termo;
                          F_ADD   my_atan_termo
                            NOP
                            NOP
                            NOP
                            NOP
                            NOP
                            SET   my_atan_resultado

                            LOD   2                      // indiceX = indiceX + 2;
                            ADD   my_atan_indiceX
                            NOP
                            SET   my_atan_indiceX

                            JMP   L4_atan                // }

@L4end_atan                 LOD   my_atan_resultado      // return resultado;
                            RET
