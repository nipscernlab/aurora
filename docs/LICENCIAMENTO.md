# Licenciamento: o que decidir antes de assinar

Escrito em 10/08/2026, depois que a troca de licença de 08/08/2026 derrubou a
elegibilidade da AURORA ao programa gratuito da SignPath Foundation. O bloqueio
em si está registrado no topo do [CODE_SIGNING.md](CODE_SIGNING.md); este
documento é a análise que sustenta a decisão, e a decisão não é técnica: ela é do
laboratório.

**Nada aqui foi executado.** Nenhuma licença foi trocada em nenhum repositório. O
que existe é uma proposta com os fatos conferidos e as perguntas que sobram.

Toda afirmação verificável abaixo foi conferida em 10/08/2026 contra a fonte
primária, e a fonte está dita junto com a afirmação. O que é opinião está dito
como opinião.

---

## 1. A restrição, na letra

Os termos da SignPath dizem, palavra por palavra:

> The project must use an OSI-approved Open Source license without commercial
> dual-licensing for all components.

São três exigências dentro de uma frase, e vale separá-las porque cada uma morde
de um jeito.

A primeira é ser aprovada pela OSI. A Licença NIPS-CERN 1.1 não é, e não por
descuido de ninguém: a seção 4 exige autorização prévia e por escrito para
exploração comercial, o que contraria o item 6 da Open Source Definition, que
proíbe discriminar campo de atuação. Não é uma licença ruim; é uma licença que
não é open source no sentido que a OSI define, e o programa da SignPath usa
exatamente essa definição.

A segunda é não haver licenciamento duplo comercial. Isso exclui o modelo
clássico de licença aberta para a comunidade e licença paga para quem quer fechar
o código. Negociar caso a caso, mantendo o copyright, não é isso; manter uma
oferta paga permanente em paralelo, é.

A terceira é o alcance, e é a que quase passa despercebida: vale para todos os
componentes. Não para o repositório, para o que está dentro do binário assinado.

## 2. O que de fato vai dentro do binário assinado

O instalador da AURORA leva três coisas de autoria do laboratório, e é preciso
olhar cada uma.

O código próprio da AURORA, que é a interface e a integração, hoje sob a
NIPS-CERN 1.1.

Os binários do yanc em `components/bin`: `cmmcomp.exe`, `asmcomp.exe`,
`appcomp.exe`, `cpppp.exe`, `cppcomp.exe`, `comp2gtkw.exe` e `gen_gtkw.exe`.

E o Verilog do SAPHO em `components/HDL`, que inclui `core.v`, `processor.v`,
`ula.v`, `instr_dec.v`, `addr_dec.v` e `myFIFO.v`. Ou seja, **o hardware que a
licença nova quer proteger viaja dentro do executável que se quer assinar de
graça**. Não dá para tratar a licença da AURORA e a do SAPHO como conversas
separadas enquanto o empacotamento for esse.

As ferramentas de terceiros não são problema e continuam como estão. Icarus e
GTKWave são GPL v2, o Verilator é LGPL v3, o Yosys é ISC, o Surfer é EUPL-1.2, e
todos entram como processo separado, à distância de um braço, conforme o anexo A2
do [LICENSE](../LICENSE) já descreve. O inventário completo está no
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## 3. A contradição que já existe, e que precisa ser resolvida em qualquer cenário

O anexo A3 do [LICENSE](../LICENSE) e a seção S1 do
[LICENSE-SAPHO.md](../LICENSE-SAPHO.md) afirmam que a cadeia YANC é obra do
laboratório e vive "sob esta mesma licença". O repositório `nipscernlab/yanc`
continua com um arquivo LICENSE que é o MIT, com copyright de 2026 em nome da
NIPSCERN. Conferido pela API do GitHub em 10/08/2026: a licença detectada é MIT e
o texto do arquivo começa com "MIT License".

São dois documentos afirmando coisas opostas sobre o mesmo código, e um deles
está errado. Pior: o MIT já concedido não volta atrás. Quem obteve o yanc v5.3,
publicado em 24/07/2026, tem direitos MIT sobre aquela versão para sempre,
independente do que os anexos passem a dizer. Uma licença nova só alcança as
versões publicadas depois dela.

Isso precisa ser resolvido mesmo que nada mais deste documento seja aceito.

## 4. Por que não comercial protege menos do que copyleft

Esta seção é opinião, mas é opinião com mecanismo.

A cláusula de exploração comercial parece o instrumento que abre parceria, e na
prática produz o contrário. Ela desqualifica o projeto de infraestrutura
gratuita, que é o caso concreto aqui, e afasta exatamente o parceiro industrial
que se quer atrair, porque o jurídico da empresa lê "depende de autorização por
escrito" e encerra a avaliação antes de alguém do laboratório ser procurado. A
conversa que a seção 3 da base quer provocar não chega a acontecer.

E ela não protege mais do que a alternativa, porque o mecanismo de defesa é o
mesmo nos dois casos: o laboratório detém o copyright e pode agir.

O que de fato abre parceria é copyleft recíproco. Qualquer um pode usar, e até
vender, mas quem distribuir derivado tem que devolver aberto nos mesmos termos. A
empresa que quer embutir o SAPHO num produto fechado não pode, e por isso vem
conversar. É a mesma conversa, provocada por uma licença que a OSI aprova.

## 5. A proposta, artefato por artefato

A estrutura de base mais anexo que a NIPS-CERN 1.1 monta continua servindo. O que
muda é qual base cada produto usa. E a boa notícia é que existem licenças
aprovadas pela OSI que fazem exatamente o que o laboratório quer: conferi a
lista oficial em `opensource.org/licenses` em 10/08/2026, e tanto a EUPL-1.2
quanto as três CERN-OHL-2.0, nas variantes P, S e W, estão nela.

### AURORA: EUPL-1.2

É aprovada pela OSI. É copyleft, e o alcance é largo, porque a definição de
"Distribution or Communication" no artigo 1 cobre "providing access to its
essential functionalities", online ou offline, o que a aproxima da AGPL sem o
vocabulário dela.

Tem três vantagens específicas para este caso. A primeira é linguística e não é
detalhe para vocês: a EUPL é publicada nas 22 línguas oficiais da União Europeia,
o português entre elas, e o artigo 13 diz que todas as versões têm valor
idêntico e que a parte escolhe a que quiser. É a mesma preocupação que fez a
NIPS-CERN 1.1 declarar que o texto em português prevalece, só que resolvida por
uma licença que já tem tradução com força jurídica.

A segunda é que ela já está dentro do instalador, porque o Surfer é EUPL-1.2, de
modo que não se introduz nenhuma pergunta nova de compatibilidade.

A terceira é o apêndice de licenças compatíveis, que lista GPL v2 e v3, AGPL v3,
LGPL v2.1 e v3, MPL v2, EPL v1.0, OSL, CeCILL e outras. Com uma vizinhança de
toolchain que é GPL e LGPL, isso é exatamente o que se quer.

Se o laboratório preferir alcance máximo e não quiser copyleft nenhum, a
alternativa é a Apache-2.0, que também é aprovada pela OSI e traz concessão
expressa de patente. O custo é abrir mão da alavanca descrita na seção 4.

### SAPHO, o Verilog: CERN-OHL-S-2.0

É a Licença de Hardware Aberto do CERN, versão 2, variante fortemente recíproca,
conforme o nome registrado no SPDX. É aprovada pela OSI e foi escrita para
hardware por quem vocês têm laboratório dentro.

Ela permite fabricar, usar e vender, e obriga quem distribui projeto modificado a
publicar as fontes. É a tradução exata, para hardware, do raciocínio da seção 4:
mantém aberto o uso, inclusive comercial, e fecha o caminho da apropriação
exclusiva, que é o que o laboratório de fato quer impedir.

A variante W, fracamente recíproca, permite embutir o SAPHO dentro de um projeto
maior sem contaminar o resto. É o botão de mais adoção e menos proteção, e a
escolha entre S e W é a decisão de fundo desta seção. A variante P é permissiva e
é generosa demais para a joia da casa.

### yanc: continuar MIT

Compilador não é onde está o valor do laboratório, o MIT já publicado não volta
atrás, e um compilador permissivo aumenta a chance de o SAPHO ser adotado, que é
o que faz o hardware importar. A ação aqui é corrigir os dois anexos da AURORA
que afirmam o contrário, e não mudar o yanc.

### docs_aurora: CC-BY-4.0

Documentação não é software e a OSI não a cobre. A CC-BY resolve limpo, e é o que
o manual offline, que viaja dentro do instalador, precisa para ser redistribuído
sem pergunta.

### A NIPS-CERN 1.1 continua viva

Ela não é jogada fora. Fica como base do laboratório para tudo que não é a pilha
SAPHO: dados, textos, imagens, outros projetos de hardware. Só os produtos que
entram no instalador assinado trocam de base, e trocam por necessidade
verificável, não por preferência.

## 6. O que preserva a parceria sem a cláusula não comercial

Quatro coisas fazem o trabalho que a seção 4 tentava fazer, e as quatro
sobrevivem a uma licença aprovada pela OSI.

**A reciprocidade do copyleft** é a alavanca real, pelo mecanismo da seção 4
acima.

**A marca** é a segunda, e é subestimada. Licença de software não concede direito
sobre nome nem logotipo, e a EUPL diz isso explicitamente na cláusula de Legal
Protection do artigo 5. Uma empresa pode bifurcar o código e não pode chamar o
resultado de SAPHO nem de AURORA. É assim que Mozilla e Red Hat protegem
identidade sendo inteiramente abertas, e não custa nada manter.

**A comunicação prévia** da seção 3 da base é a melhor ideia do texto de vocês, e
o motivo escrito lá é bom: a conversa acontece antes do trabalho, não depois.
Como condição de licença ela quebra a aprovação da OSI, porque acrescenta
restrição ao uso. Como pedido documentado no README e no CONTRIBUTING ela custa
zero e funciona quase igual, porque quem quer parceria escreve de qualquer jeito.

**O CLA** é o que mais importa e é o que garante a opcionalidade futura. A cessão
da seção 5 precisa virar um CLA de verdade, assinado por quem contribui. Detendo
todo o copyright, o laboratório nunca fica preso ao próprio copyleft: o titular
não é licenciado de si mesmo, e pode conceder termos diferentes a um parceiro
quando quiser. Copyleft mais CLA é precisamente a posição que mantém todas as
portas comerciais abertas, e é por isso que empresas que vivem de software aberto
usam essa combinação.

O limite honesto, para ninguém descobrir depois: montar uma oferta permanente de
licença proprietária paga é o licenciamento duplo comercial que a SignPath
exclui, e nesse dia o certificado gratuito cai. Não é grave. Um certificado pago
custa algumas centenas de dólares por ano, o que é irrelevante perto de uma
receita de licenciamento; e se a receita não existir, o gratuito continua valendo.

## 7. O que eu não sei, e que precisa de decisão de gente

Não sou advogado, e três coisas aqui exigem quem seja.

Propriedade intelectual gerada em universidade pública brasileira passa pela Lei
de Inovação, e a UFJF tem Núcleo de Inovação Tecnológica. É bem possível que o
licenciamento do SAPHO não seja decisão que o laboratório tome sozinho, e
descobrir isso antes de publicar a mudança é muito mais barato do que descobrir
depois.

A dupla afiliação com o CERN pode trazer obrigações próprias sobre o que é
produzido lá, e isso está fora do que dá para ler no repositório.

E a escolha entre CERN-OHL-S e CERN-OHL-W para o Verilog do SAPHO é uma decisão
de estratégia do grupo, não uma conclusão técnica. Eu recomendo a S, mas quem
sabe se o objetivo é adoção ampla ou proteção do núcleo é vocês.

## 8. Ordem de execução

Primeiro, mandar o e-mail do anexo abaixo para a SignPath. Custa dez minutos, e a
resposta deles pode encurtar tudo o que vem depois. Não faz sentido reescrever
três licenças antes de saber se eles têm alguma acomodação para este caso.

Segundo, decidir as bases com o orientador, e com o NIT se for o caso.

Terceiro, resolver a contradição do yanc, que precisa ser resolvida
independentemente do resto.

Quarto, aplicar, com um commit por repositório e a reescrita dos três anexos.

O trabalho de assinatura só começa depois disso, conforme a ordem da seção 3
do [TODO.md](../TODO.md).

---

## Anexo: rascunho do e-mail para a SignPath

Para `support@signpath.io`, ou pelo canal de suporte de dentro do painel deles.
Em inglês, e curto de propósito: a pergunta é uma só, e enterrá-la em contexto
diminui a chance de resposta útil.

> **Subject:** Licence change on an approved Foundation project — is AURORA IDE
> still eligible? (org `SAPHO [OSS]`, project `aurora`)
>
> Hello,
>
> We maintain AURORA IDE (`github.com/nipscernlab/aurora`), approved for the
> SignPath Foundation programme on 2026-08-06 under organisation `SAPHO [OSS]`.
> We have not signed anything yet.
>
> On 2026-08-08 we replaced the project's MIT licence with our laboratory's own
> licence, the NIPS-CERN Licence 1.1. It grants free use, study, modification and
> redistribution, but section 4 requires prior written authorisation for
> commercial exploitation, defined as selling the work itself or charging for it.
> Using the software as a tool inside a commercial activity is explicitly free.
>
> We understand this is very likely outside your eligibility rule, which requires
> "an OSI-approved Open Source license without commercial dual-licensing for all
> components", since a non-commercial clause conflicts with item 6 of the Open
> Source Definition. We would rather ask than assume, and we would rather ask
> before signing anything than after.
>
> Three questions:
>
> 1. Is our reading correct, so that AURORA is no longer eligible as it stands?
> 2. If we move the IDE to EUPL-1.2 and the hardware design to CERN-OHL-S-2.0,
>    both OSI-approved, would that restore eligibility? The installer ships our
>    own compilers (MIT) and our own Verilog source alongside the application, so
>    we want to be sure the "all components" wording is satisfied by that split.
> 3. We hold the copyright and intend to keep the option of negotiating
>    individual agreements with industrial partners in the future. We do not
>    offer, and do not plan to advertise, a paid proprietary licence in parallel.
>    Does that conflict with the "without commercial dual-licensing" condition?
>
> We are a university research group at the Federal University of Juiz de Fora,
> Brazil, working with CERN, and the software is used to teach an undergraduate
> course. Whatever the answer, we would rather have the project in the right
> state than have a signature we are not entitled to.
>
> Thank you,
