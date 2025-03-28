#include <stdio.h>
#include <string.h>
#include <math.h>
#include <stdlib.h>

float b2mf(char *ifl, int nbm, int nbe)
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
    char ma[10], ex[10];
    int  i, nbm, nbe, nbi;

    char bufi[1025], bufo[1025];

    while (!feof(stdin))
    {
        bufi[0] = 0;
        fscanf(stdin, "%s", bufi);
        if (bufi[0]) 
        {
            for (i=0; i<8; i++)
            {
                ma[i] = bufi[i  ];
                ex[i] = bufi[i+8];
            }
            ma[8] = 0;
            ex[8] = 0;

            nbm = strtol(ma,NULL,2);
            nbe = strtol(ex,NULL,2);
            nbi = nbm+nbe+1;

            char chx[64];
            for (i=0; i<=nbi; i++) chx[i] = bufi[16+i];
            float f = b2mf(chx,nbm,nbe);

            sprintf(bufo, "%.3f", f);
             printf("%s\n",    bufo);
             fflush(stdout);
        }
    }
    
    return 0;
}