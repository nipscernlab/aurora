
// Funcao resto da divisao ----------------------------------------------------

@int_mod   SET_P resto_b // int int_mod(int a, int b)
           SET   resto_a

           LOD   resto_a // a-(a/b)*b; 
         P_LOD   resto_b
           CAL   int_div
           MLT   resto_b
           NEG
           ADD   resto_a
           RET