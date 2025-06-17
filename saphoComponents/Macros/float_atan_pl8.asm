
// Funcao arco-tangente -------------------------------------------------------

@float_atan                 SET   my_atan_x              // pega parametro x

                          F_ABS_M my_atan_x              // float ax = abs(x);
                            SET   my_atan_ax

                            LOD   my_atan_ax             // if (ax == 0.0) return 0.0;
                          P_LOD   0.0
                          S_EQU
                            NOP
                            JIZ   L1else_atan
                            LOD   0.0
                            RET

@L1else_atan                LOD   my_atan_ax             // if (ax > 1.02) return sign(x, 1.5707963268) - my_atan(1.0/x);
                          P_LOD   1.02
                         SF_GRE
                            NOP
                            NOP
                            NOP
                            JIZ   L2else_atan
                            LOD   1.5707963268
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

@L2else_atan                LOD   my_atan_ax             //if (ax > 0.98)
                          P_LOD   0.98
                         SF_GRE
                            NOP
                            NOP
                            NOP
                            JIZ   L3else_atan

                          F_NEG_M 1.0                    // float xm1 = ax-1.0;
                          F_ADD   my_atan_ax
                            NOP
                            NOP
                            NOP
                            NOP
                            NOP
                            SET   my_atan_xm1

                            LOD   my_atan_xm1            // return sign(x, 0.7853981634 + xm1*0.5 - xm1*xm1*0.25);
                          F_MLT   0.5
                            NOP
                            NOP
                            NOP
                            NOP
                          F_ADD   0.7853981634
                            NOP
                            NOP
                            NOP
                            NOP
                            NOP
                          P_LOD   my_atan_xm1
                          F_MLT   my_atan_xm1
                            NOP
                            NOP
                            NOP
                            NOP
                          F_MLT   0.25
                            NOP
                            NOP
                            NOP
                            NOP
                          F_NEG
                         SF_ADD
                            NOP
                            NOP
                            NOP
                            NOP
                            NOP
                          F_SGN   my_atan_x
                            RET

@L3else_atan                LOD   my_atan_x              // float termo = x;
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

                            LOD   my_atan_x2             // float tolerancia = 0.000008/x2;
                            CAL   float_inv
                          F_MLT   epsilon_taylor
                            NOP
                            NOP
                            NOP
                            NOP
                            SET   my_atan_tolerancia

                            LOD   3                      // int indiceX = 3;
                            SET   my_atan_indiceX

@L4_atan                  F_ABS_M my_atan_termo          // while ((abs(termo) > tolerancia) && (indiceX < 100))
                          P_LOD   my_atan_tolerancia
                         SF_GRE
                            NOP
                            NOP
                            NOP
                          P_LOD   100
                            LES   my_atan_indiceX
                            NOP
                          S_LAN
                            NOP
                            NOP
                            JIZ   L4end_atan

                            NEG_M 2                      // termo = termo * (- x2 * (indiceX - 2)) / indiceX;
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

                            LOD   my_atan_indiceX        // indiceX = indiceX + 2;
                            ADD   2
                            NOP
                            SET   my_atan_indiceX

                            JMP   L4_atan
@L4end_atan                 LOD   my_atan_resultado      // return resultado;
                            RET