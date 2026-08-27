# SAPHO, Referência Técnica

Relatório técnico-descritivo do **núcleo da plataforma SAPHO** (a IDE **AURORA**, os compiladores
**YANC**, o *toolchain bundle* e os subsistemas PRISM e Aurora Intelligence), construído a partir do
**estudo direto do código-fonte** dos repositórios da organização `nipscernlab`.

> **Fonte da verdade = o código.** A documentação `.md` existente foi usada apenas como pista; cada
> afirmação foi verificada contra a implementação real.

## O entregável (edição compacta, ≤ 20 páginas)

```
referencia-tecnica-sapho/
├── main.tex          # documento compacto e denso (classe article), ESTE é o entregável
├── secoes/           # S01..S16 (15 seções destiladas + glossário/referências)
├── _lint.js          # checagem estrutural de LaTeX (sem compilar)
└── _fonte/           # material extenso verificado (opcional, ver abaixo)
```

Compilar (requer TeX Live 2021+ ou MiKTeX; todos os pacotes são padrão):

```bash
pdflatex main.tex
pdflatex main.tex      # 2ª passada resolve sumário e referências cruzadas
# ou:  latexmk -pdf main.tex
```

Resultado: `main.pdf` (~14–18 páginas, denso).

## Material extenso (`_fonte/`, opcional)

Durante a construção foi produzida uma **versão longa e exaustiva** (18 capítulos, ~75 mil palavras),
cada um estudado e verificado contra o código por agentes independentes. Ela é a base de onde a
edição compacta foi destilada e fica guardada como material de apoio:

```
_fonte/
├── main.tex          # versão extensa (classe report), compile aqui se quiser o documento completo
├── capitulos/        # 01..18
├── apendices/        # glossário e referências (versão longa)
└── _build/           # scripts usados na geração (provenance)
```

Compilar a versão extensa: `cd _fonte && pdflatex main.tex && pdflatex main.tex`.

## Escopo

Núcleo SAPHO: `aurora`, `yanc`, `aurora-toolchain`, canal `sapho`, *forks* `gtkwave-nipscern` e
`netlistsvg-aurora`, e o subsistema *Aurora Intelligence*. Suíte documentada: **6.3.2** (junho de 2026).
