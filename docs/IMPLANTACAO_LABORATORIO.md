# Implantação do SAPHO/AURORA em laboratório

Documento para o suporte técnico. Descreve o que a IDE instala, onde,
o que ela executa em tempo de compilação, e o que precisa ser liberado
em máquinas com política restritiva.

Contexto: disciplina de Dispositivos Lógicos Programáveis, Engenharia
Elétrica — Sistemas Eletrônicos, UFJF. A instalação é feita uma vez por
máquina; as atualizações seguintes chegam pelo atualizador embutido, sem
intervenção presencial.

---

## 1. Resumo para quem só precisa liberar

| Item | Valor |
|------|-------|
| Instalação | Por usuário. **Não requer administrador.** |
| Diretório do programa | `%LOCALAPPDATA%\Programs\Aurora-IDE\` |
| Dados do usuário e logs | `%APPDATA%\SAPHO\` |
| Cache do atualizador | `%LOCALAPPDATA%\sapho-updater\` |
| Toolchain (compiladores) | `%LOCALAPPDATA%\Programs\Aurora-IDE\components\` |
| Espaço em disco, por usuário | ~1,6 GB (≈1,1 GB instalado + ≈0,5 GB de instalador em cache) |
| Rede | HTTPS para `github.com` e `objects.githubusercontent.com` |
| Assinatura digital | **Ausente hoje.** Ver §5. |

O ponto que costuma travar: a IDE **executa compiladores a partir do perfil
do usuário**. Políticas do tipo "bloquear execução fora de Arquivos de
Programas" impedem o funcionamento, mesmo com a instalação bem-sucedida.
Ver §4.

---

## 2. Por que a instalação é por usuário

O instalador é NSIS em modo `oneClick`, sem elevação. Isso é deliberado:
o atualizador precisa substituir os binários sozinho, e uma instalação em
`Arquivos de Programas` exigiria consentimento de administrador **a cada
atualização** — o que, numa máquina onde o aluno não é administrador,
significa que a atualização simplesmente nunca aconteceria.

A contrapartida é que cada perfil de usuário carrega sua própria cópia.
Num laboratório com login individual, o espaço em disco cresce por aluno
que usar a máquina. Dimensione por §1.

Se o perfil for descartado no logoff (congelamento de imagem), a
instalação some junto e precisa ser refeita — nesse cenário, a IDE deve
entrar na imagem base, não ser instalada por aluno.

---

## 3. O que a IDE executa

A IDE é um ambiente de desenvolvimento de hardware: ela **existe** para
invocar compiladores e simuladores. Todos ficam em `components\`, dentro do
diretório de instalação, e são lançados como processos filhos.

| Programa | Origem | Papel |
|----------|--------|-------|
| `cmmcomp.exe`, `appcomp.exe`, `asmcomp.exe`, `cppcomp.exe`, `cpppp.exe` | compiladores SAPHO (NIPSCERN) | C± / C++ → Assembly → Verilog |
| `iverilog.exe`, `vvp.exe` | Icarus Verilog | simulação |
| `verilator`, `g++.exe`, `make.exe`, `perl.exe` | Verilator + mingw64 | simulação rápida (compila C++ gerado) |
| `yosys.exe` | Yosys | síntese, diagramas RTL |
| `gtkwave.exe`, `fst2vcd.exe` | GTKWave (fork NIPSCERN) | formas de onda |
| `python.exe` | Python 3.12 embutido | testbenches cocotb |
| `verible-verilog-ls.exe`, `slang-server.exe`, `clang-format.exe` | ferramentas de linguagem | análise e formatação no editor |

Duas observações que importam para antivírus:

1. **O fluxo do Verilator compila e executa código nativo em tempo de uso.**
   Ele gera C++ a partir do Verilog do aluno, chama `g++` e roda o `.exe`
   resultante em `components\Temp\obj_dir_*\`. Um executável recém-compilado,
   sem assinatura, rodando a partir do perfil do usuário é exatamente o
   padrão que heurísticas de antivírus sinalizam.
2. **A IDE não baixa nem executa nada fora dessa lista.** O conjunto é
   fechado por uma allowlist no código
   ([`main/compile/binary_allowlist.js`](../main/compile/binary_allowlist.js)):
   qualquer binário fora dela é recusado, independentemente de quem pediu.

---

## 4. Windows Defender e políticas de execução

### 4.1 Exclusões de pasta

Sem exclusão, o Defender inspeciona cada artefato produzido pela
compilação. O efeito não é bloqueio, e sim lentidão: uma compilação com
Verilator gera centenas de arquivos intermediários, e cada um passa pela
varredura em tempo real.

Aplicar por GPO, ou via PowerShell administrativo em cada máquina:

```powershell
# Ajuste <USUARIO> ou aplique por GPO com variavel de ambiente por usuario.
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Programs\Aurora-IDE"
Add-MpPreference -ExclusionPath "$env:APPDATA\SAPHO"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\sapho-updater"
```

A terceira linha evita que o instalador de ~500 MB seja varrido de novo a
cada atualização.

Se a política preferir exclusão por processo em vez de por pasta, os
processos relevantes são os da tabela em §3.

### 4.2 AppLocker / SRP — o ponto crítico

Se as máquinas usam AppLocker (ou Software Restriction Policies) com a
regra padrão "permitir execução apenas em `%ProgramFiles%` e
`%SystemRoot%`", a IDE **não funciona**, mesmo instalada: nada dentro de
`%LOCALAPPDATA%` pode executar.

São necessárias regras de exceção por caminho:

```
%LOCALAPPDATA%\Programs\Aurora-IDE\*
%LOCALAPPDATA%\Programs\Aurora-IDE\components\*
```

A segunda é indispensável e costuma ser esquecida: sem ela a IDE abre
normalmente e só falha na hora de compilar, com mensagens de erro que
parecem bug da aplicação.

O diretório de trabalho `components\Temp\` também precisa permitir
execução, por causa do executável gerado pelo Verilator (§3, item 1).

### 4.3 SmartScreen

Na primeira execução do instalador o SmartScreen exibe "O Windows protegeu
o computador", porque o executável não é assinado (§5). O caminho é
*Mais informações* → *Executar assim mesmo*. Se a política bloquear isso
sem alternativa, o instalador precisa ser distribuído por um canal
confiável configurado pela TI.

---

## 5. Assinatura digital

O instalador **não é assinado** hoje. Está em curso a solicitação ao
programa gratuito da SignPath Foundation, ao qual o projeto se qualifica
por ser software livre sob licença MIT. Detalhes e o estado do processo em
[CODE_SIGNING.md](CODE_SIGNING.md).

Até lá, a verificação de integridade possível é o hash. Cada versão
publica o `sha512` do instalador no arquivo `latest.yml`, ao lado do
`.exe`, em <https://github.com/nipscernlab/sapho/releases>. O próprio
atualizador confere esse hash antes de aplicar qualquer atualização, e
recusa o arquivo se não bater.

---

## 6. Rede

A IDE acessa a rede em três situações. Nenhuma é necessária para compilar:
uma máquina sem internet continua funcionando, apenas não se atualiza.

| Quando | Destino | Obrigatório |
|--------|---------|-------------|
| Verificar/baixar atualização | `github.com`, `objects.githubusercontent.com` | não |
| Assistente de IA | provedor escolhido pelo usuário | não |
| Bibliotecas Python | `github.com` (repositório `aurora-pylibs`) | não |

Atrás de proxy autenticado, o atualizador usa a configuração de proxy do
sistema (Electron/Chromium). Se a verificação falhar, ela é repetida
automaticamente com espera crescente (1 min, 5 min, 15 min, depois de hora
em hora) e o estado fica visível em *Configurações → Sobre → Atualizações*.

---

## 7. Como as atualizações chegam

1. A IDE verifica o canal de distribuição alguns segundos após abrir, e
   depois a cada 3 horas.
2. Havendo versão nova, uma janela mostra as novidades e pergunta. Nada é
   baixado sem o aluno aceitar.
3. O download é **incremental**: o instalador anterior fica em cache
   (`%LOCALAPPDATA%\sapho-updater\installer.exe`) e só os blocos que
   mudaram são transferidos. Uma atualização típica é uma fração dos
   ~500 MB do instalador completo — desde que a toolchain não tenha
   mudado naquela versão.
4. Se a conexão cair no meio, o download é retomado automaticamente.
5. Ao fechar a IDE, a atualização já baixada é aplicada em silêncio, sem
   pedir nada e sem elevação.

### Diagnóstico remoto

Quando uma máquina parar de atualizar, peça ao aluno para abrir
*Configurações → Sobre → Atualizações*. O painel mostra a situação, quando
foi a última verificação, quando será a próxima, o canal, e o último erro.
O botão *Abrir log* revela `main.log`, que é o arquivo a anexar num
relatório.

---

## 8. Verificação após instalar

Roteiro mínimo para confirmar que a máquina está utilizável. Se algum
passo falhar, o problema é quase sempre §4.2.

1. A IDE abre e mostra a tela inicial.
2. Abrir um projeto de exemplo e clicar em compilar — deve concluir sem
   erro. Isso exercita os compiladores SAPHO.
3. Executar a simulação e abrir as formas de onda — exercita
   Icarus/Verilator, GTKWave e a execução a partir de `components\Temp\`.
4. *Configurações → Sobre → Atualizações*: a situação não deve ser
   "Não está conseguindo alcançar o servidor de atualização".
