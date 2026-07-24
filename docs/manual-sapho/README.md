# SAPHO — Manual do Usuário

Documentação viva da plataforma SAPHO (AURORA + YANC + toolchain), em formato de livro,
para o usuário final que parte do zero. Português brasileiro.

## Compilar

```
pdflatex main && pdflatex main && pdflatex main
```

(três passadas para sumário e referências cruzadas). Saída: `main.pdf`.

## Estrutura

- `main.tex` — preâmbulo (paleta AURORA real de `css/base/theme_variables.css`), capa e ordem dos capítulos.
- `capitulos/NN-*.tex` — um arquivo por capítulo; `A-`–`D-` são os apêndices.
- Módulos (Partes): Primeiros passos · Projetos e processadores · Linguagem C± ·
  Editor · Compilação e simulação · Visualização · Aurora Intelligence ·
  Ferramentas de apoio · Manutenção · Apêndices.

## Convenções

- Fonte da verdade: **código dos repositórios** (aurora, yanc, surfer-aurora), nunca docs intermediárias.
  Papers servem só para história/terminologia.
- Grafias oficiais: **NIPS-CERN**, **SAPHO** = *Scalable-Architecture Processor for Hardware Optimization*,
  **AURORA** = *Advanced Utility Running Optimized Resource Architectures*, **YANC** = *Yet Another Compiler*,
  **PRISM** = *Processor Rendering Interface for Schematic Models*. Aurora Intelligence é feminino.
- Caixas: `nota` (menta), `info` (ciano), `aviso` (âmbar), `perigo` (vermelho) — cores de status da IDE.
- Exemplo condutor: processador `media_movel` no projeto `MeuFiltro`.
- Prints pendentes: marcados no PDF com `\figurapendente{título}{instrução}` (numerados).
  Ao receber o print, salvar em `figuras/` e substituir o marcador por `\begin{figure}...\includegraphics...`.

## Doc viva

Ao alterar AURORA/YANC/componentes, atualizar o capítulo correspondente no mesmo PR/commit.
Cada capítulo é autocontido justamente para isso.
