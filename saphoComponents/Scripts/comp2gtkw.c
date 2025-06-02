// ----------------------------------------------------------------------------
// tradutor de num complexo para o gtkwave ------------------------------------
// ----------------------------------------------------------------------------

#include   <math.h>
#include  <stdio.h>
#include <stdlib.h>

// binario (em ascii) para meu float
float b2mf(char *ifl, int nbm, int nbe)
{
    // sinal ------------------------------------------------------------------

    int s = ifl[0] == '1';

    // expoente ---------------------------------------------------------------

    char exb[64]; for (int i=0;i<nbe;i++) exb[i] = ifl[i+1]; exb[nbe]=0;

    int es = exb[0] == '1';
    if (es) for (int i=0;i<nbe;i++) exb[i] = (exb[i] == '1') ? '0' : '1';

    char *endp;
    int e = strtol(exb,&endp,2);
    if (es) e = -(e+1);

    // mantissa ---------------------------------------------------------------

    char mab[64]; for (int i=0;i<nbm;i++) mab[i] = ifl[nbe+1+i]; mab[nbm]=0;

    int  m = strtol(mab,&endp,2);

    // gera o float -----------------------------------------------------------

    float  f = m * pow(2,e);
    if (s) f = -f;

    return f;
}

int main(int argc, char **argv)
{
    char ma[10], ex[10];
    int  i,nbm,nbe,nbits;

    char  bufi[1025], bufo[1025];
    char  re  [64]  , im  [64];
    int   dre,dim;
    char *endp;
    float fre,fim;

    while (!feof(stdin))
    {
        bufi[0] = 0;
        fscanf(stdin, "%s", bufi);
        if (bufi[0]) 
        {
            // os primeiros 16 bits codificam o nbm e nbe
            for (i=0; i<8; i++)
            {
                ma[i] = bufi[i  ];
                ex[i] = bufi[i+8];
            }
            ma[8] = 0;
            ex[8] = 0;

            nbm   = strtol(ma,NULL,2);
            nbe   = strtol(ex,NULL,2);
            nbits = nbm+nbe+1;

            // agora pega a parte real e imag
            for (i=0;i<nbits;i++)
            {
                re[i] = bufi[16+i];
                im[i] = bufi[16+i+nbits];
            }
            re[nbits] = 0;
            im[nbits] = 0;

            // gera o float equivalente
            float fre = b2mf(re,nbm,nbe);
            float fim = b2mf(im,nbm,nbe);

            sprintf(bufo, "%.3f %.3fi", fre, fim);
             printf("%s\n", bufo);
             fflush(stdout);
        }
    }

    return 0;
}