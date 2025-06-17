
// Funcao reciproco -----------------------------------------------------------

@float_inv              SET   finv_x     // float float_inv(float x)

                        LOD   1.0        // float s = sign(x, 1.0);
                      F_SGN   finv_x
                        SET   finv_s

                      F_ABS_M finv_x     // x = abs(x);
                        SET   finv_x

                        LOD   0          // int k = 0;
                        SET   finv_k

@L1_finv                LOD   finv_x     // while (x > 1.5)
                      P_LOD   1.5
                     SF_GRE
                        JIZ   L1end_finv
                        
                        LOD   finv_x     // x = x * 0.5;
                      F_MLT   0.5
                        SET   finv_x

                        LOD   finv_k     // k++;
                        ADD   1
                        SET   finv_k

                        JMP   L1_finv    // } (while)

@L1end_finv @L2_finv    LOD   finv_x     // while (x < 0.5)
                      P_LOD   0.5
                     SF_LES
                        JIZ   L2end_finv

                        LOD   finv_x     // x = x * 2.0;
                      F_MLT   2.0
                        SET   finv_x

                        NEG_M 1          // k = k-1;
                        ADD   finv_k
                        SET   finv_k

                        JMP   L2_finv    // } (while)

@L2end_finv             LOD   1.0        // float y = 1.0;
                        SET   finv_y

                        LOD   0          // int m = 0;
                        SET   finv_m

@L3_finv                LOD   6          // while (m < 6)
                        LES   finv_m
                        JIZ   L3end_finv

                        LOD   finv_x     y = y*(2.0 - x*y);
                      F_MLT   finv_y
                      F_NEG
                      F_ADD   2.0
                      F_MLT   finv_y
                        SET   finv_y

                        LOD   finv_m     // m++;
                        ADD   1
                        SET   finv_m

                        JMP   L3_finv    // } (while)

@L3end_finv @L4_finv    LOD   0          // while (k > 0)
                        GRE   finv_k
                        JIZ   L4end_finv

                        LOD   finv_y     // y = y*0.5;
                      F_MLT   0.5
                        SET   finv_y

                        NEG_M 1          // k = k-1;
                        ADD   finv_k
                        SET   finv_k

                        JMP   L4_finv    // } (while)

@L4end_finv @L5_finv    LOD   0          // while (k < 0)
                        LES   finv_k
                        JIZ   L5end_finv

                        LOD   finv_y     // y = y*2.0;
                      F_MLT   2.0
                        SET   finv_y

                        LOD   finv_k     // k++;
                        ADD   1
                        SET   finv_k

                        JMP   L5_finv    // } (while)

@L5end_finv             LOD   finv_y     // return y*s;
                      F_MLT   finv_s
                        RET
