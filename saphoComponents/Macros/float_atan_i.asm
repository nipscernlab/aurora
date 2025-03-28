
// Funcao arco-tangente -------------------------------------------------------

@float_atani SET my_atan_x          // pega parametro x

EQU    0.0                          // if (x == 0) return 0.0;
JIZ    L1else_atani
LOD    0.0
RET

@L1else_atani F_ABS_M my_atan_x     // if (abs(x) == 1.0) return sign(x,pi2*0.5);
EQU     1.0
JIZ     L2else_atani
LOD     1.57079632679489661923      // pi/2
F_MLT   0.5
F_SGN   my_atan_x
RET
JMP     L2end_atani

@L2else_atani F_ABS_M my_atan_x     // else if (abs(x) > 1.0) return sign(x,pi2) - atan(1.0/x);
F_LES   1.0
JIZ     L3else_atani
LOD     1.57079632679489661923      // pi/2
F_SGN   my_atan_x
P_LOD   my_atan_x
F_DIV   1.0
CAL     float_atani
F_NEG
SF_ADD
RET

@L3else_atani @L2end_atani LOD my_atan_x  // float termo = x;
SET     my_atan_termo

LOD     my_atan_x                         // float x2 = x*x;
F_MLT   my_atan_x
SET     my_atan_x2

LOD     my_atan_termo                     // float resultado = termo;
SET     my_atan_resultado

LOD     my_atan_x2                        // float tolerancia = epslon/x2;
F_DIV   epsilon_taylor
SET     my_atan_tolerancia

LOD 3                                     // int indiceX = 3;
SET     my_atan_indiceX

@L4_atani F_ABS_M my_atan_termo           // while (abs(termo) > tolerancia)
F_LES   my_atan_tolerancia
JIZ     L4end_atani

LOD    -2                                 // termo = termo * (- x2 * (indiceX - 2)) / indiceX;
ADD     my_atan_indiceX
I2F
F_MLT   my_atan_x2
F_NEG
F_MLT   my_atan_termo
P_I2F_M my_atan_indiceX
SF_DIV
SET     my_atan_termo

LOD     my_atan_resultado                 // resultado = resultado + termo;
F_ADD   my_atan_termo
SET     my_atan_resultado

LOD     2                                 // indiceX = indiceX + 2;
ADD     my_atan_indiceX
SET     my_atan_indiceX

JMP     L4_atani                          // }

@L4end_atani LOD my_atan_resultado        // return resultado;
RET