
// Funcao sqrt para float -----------------------------------------------------

@float_sqrt SET sqrt_num     // pega parametro
@L1_sqrt    SET sqrt_x       // atualiza x

DIV sqrt_num                 // iteracao
ADD sqrt_x
MLT 0.5
SET sqrt_raiz

NEG                          // abs(x - raiz)
ADD sqrt_x
ABS                          // precisa mesmo desse ABS?

GRE epsilon_taylor           // checa tolerancia
JZ L2else_sqrt

LOAD sqrt_raiz               // finaliza
RETURN

@L2else_sqrt LOAD sqrt_raiz  // se nao terminou...
JMP L1_sqrt                  // volta

