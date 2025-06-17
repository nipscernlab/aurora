
// Funcao seno ----------------------------------------------------------------

@float_sin    SET   sin_x          // pega parametro x

              EQU    0.0           // if (x == 0) return 0.0;
              JIZ    L1_sin
              LOD    0.0
              RET

@L1_sin     F_ABS_M sin_x          // while (abs(x) > 3.141592654) x = x - sign(x, 6.283185307);
            F_LES   3.141592654
              JIZ   L1end_sin
              LOD   6.283185307
            F_SGN   sin_x
            F_NEG
            F_ADD   sin_x
              SET   sin_x
              JMP   L1_sin

@L1end_sin    LOD   sin_x          // float termo = x;
              SET   sin_termo

              LOD   sin_x          // float x2 = x * x;
            F_MLT   sin_x
              SET   sin_x2

              LOD   sin_termo      // float resultado = termo;
              SET   sin_resultado

              LOD   sin_x2         // float tolerancia = epslon/x2;
            F_DIV   epsilon_taylor
              SET   sin_tolerancia

              LOD   3              // int indiceX = 3;
              SET   sin_indiceX

@L2_sin     F_ABS_M sin_termo      // while (abs(termo) > tolerancia) {
            F_LES   sin_tolerancia
              JIZ   L2end_sin

            F_NEG_M sin_x2         // termo = termo * (- x2) / ((indiceX - 1) * indiceX);
            F_MLT   sin_termo
            P_NEG_M 1
              ADD   sin_indiceX
              MLT   sin_indiceX
              I2F
           SF_DIV
              SET   sin_termo

              LOD   sin_resultado  // resultado = resultado + termo;
            F_ADD   sin_termo
              SET   sin_resultado

              LOD   sin_indiceX    // indiceX = indiceX + 2;
              ADD   2
              SET   sin_indiceX

              JMP   L2_sin         // }

@L2end_sin    LOD   sin_resultado  // return resultado;
              RET
