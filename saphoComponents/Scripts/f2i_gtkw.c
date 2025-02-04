#include <stdio.h>
#include <string.h>
#include <math.h>
#include <stdlib.h>

float i2mf(unsigned int ifl, int nbm, int nbe)
{
    // sinal
    int s = ifl >> (nbm+nbe);

    // expoente
    int e = ifl << 1;
    e = e >> (1+nbm);

    // mantissa
    int m = ((1 << nbm) - 1) & ifl;

    // gera o float
    float f = m * pow(2,e);
    if (s) f = -f;

    return f;
}

int main(int argc, char **argv)
{
    char   fname[64], man[16], exp[16];
    FILE  *flog = fopen("log.txt", "r");
    fscanf(flog,"%s %s %s", fname, man, exp);

    int nbm = atoi(man);
    int nbe = atoi(exp);

    char bufi[1025], bufo[1025];

    while (!feof(stdin))
    {
        bufi[0] = 0;
        fscanf(stdin, "%s", bufi);
        if (bufi[0]) 
        {
            unsigned int x;
            sscanf(bufi, "%u", &x); //strtol();
            float f = i2mf(x,nbm,nbe);
            sprintf(bufo, "%d", (int)f);
            printf("%s\n", bufo);
            fflush(stdout);
        }
    }
    return 0;
}