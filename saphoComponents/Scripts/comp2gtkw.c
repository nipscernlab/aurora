#include <stdio.h>
#include <string.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

float i2mf(char *ifl, int nbm, int nbe)
{
    int i;

    // sinal
    int s = ifl[0] == '1';

    // expoente
    char exb[64];

    for (i=0;i<nbe;i++) exb[i] = ifl[i+1];
    exb[nbe]=0;

    int es = exb[0] == '1';
    if (es)
    {
        for (i=0;i<nbe;i++) exb[i] = (exb[i] == '1') ? '0' : '1';
    }

    char *endp;
    int e = strtol(exb,&endp,2);
    if (es) e = -(e+1);

    // mantissa
    char mab[64];

    for (i=0;i<nbm;i++)   {
        mab[i] = ifl[nbe+1+i];
    }
    mab[nbm]=0;

    int m = strtol(mab,&endp,2);

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

    int   nbm = atoi(man);
    int   nbe = atoi(exp);
    int   nbits = nbm+nbe+1;
    char  bufi[1025], bufo[1025];
    char  re[64], im[64];
    int   dre,dim;
    char *endp;
    float fre,fim;

    while (!feof(stdin))
    {
        bufi[0] = 0;
        fscanf(stdin, "%s", bufi);
        if (bufi[0]) 
        {
            for (int i=0;i<nbits;i++)
            {
                re[i] = bufi[i];
                im[i] = bufi[i+nbits];
            }
            re[nbits] = 0;
            im[nbits] = 0;

            float fre = i2mf(re,nbm,nbe);
            float fim = i2mf(im,nbm,nbe);

            sprintf(bufo, "%.3f %.3fi", fre, fim);
            printf("%s\n", bufo);
            fflush(stdout);
        }
    }
    return 0;
}