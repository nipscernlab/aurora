# SAPHO — Manual do Usuário

Documentação viva da plataforma SAPHO (AURORA + YANC + toolchain), em formato de livro,
para o usuário final que parte do zero. Português brasileiro.

## Compilar

```
pdflatex main && pdflatex main && pdflatex main
```

(três passadas para sumário e referências). Saída: `main.pdf`.

## Projeto gráfico

Livro clássico de ensino de tecnologia: tipografia Palatino (mathpazo, algarismos antigos,
versalete), paleta sóbria de tinta e bronze, parágrafos com recuo, cabeços em versalete,
código com régua fina à esquerda, caixas de nota/informação/aviso/cuidado com rótulo
em versalete colorido.

## Estilo de escrita (obrigatório)

Segue as CONVENCOES-GERAIS do grupo (`C:\Users\chrys\Desktop\ENMC-2026\CONVENCOES-GERAIS.md`):

- sem travessões (`---`); usar vírgulas, dois-pontos, ponto-e-vírgula e parênteses;
- sem negrito no corpo do texto; ênfase rara com itálico;
- prosa corrida encadeada; listas apenas para procedimentos passo a passo
  e tabelas apenas para referência genuína;
- estrangeirismos em itálico; siglas expandidas na primeira ocorrência;
- figuras e tabelas sempre citadas no texto.

## Estrutura

- `main.tex` — preâmbulo, capa e ordem dos capítulos.
- `capitulos/NN-*.tex` — um arquivo por capítulo; `A-`–`D-` são os apêndices.
- Módulos (Partes): Primeiros passos · Projetos e processadores · Linguagem C± ·
  Editor · Compilação e simulação · Visualização · Aurora Intelligence ·
  Ferramentas de apoio · Manutenção · Apêndices.

## Convenções de conteúdo

- Fonte da verdade: código dos repositórios (aurora, yanc, surfer-aurora), nunca docs
  intermediárias; papers servem para história e terminologia.
- Grafias oficiais: NIPS-CERN; SAPHO = *Scalable-Architecture Processor for Hardware
  Optimization*; AURORA = *Advanced Utility Running Optimized Resource Architectures*;
  YANC = *Yet Another Compiler*; PRISM = *Processor Rendering Interface for Schematic
  Models*. Aurora Intelligence é feminino.
- Exemplo condutor: processador `media_movel` no projeto `MeuFiltro`.
- Prints pendentes: marcados no PDF com `\figurapendente{título}{instrução}` (numerados).
  Ao receber o print, salvar em `figuras/` e substituir o marcador por
  `\begin{figure}...\includegraphics...` com a figura citada no texto.

## Doc viva

Ao alterar AURORA/YANC/componentes, atualizar o capítulo correspondente no mesmo
PR/commit. Cada capítulo é autocontido justamente para isso.
