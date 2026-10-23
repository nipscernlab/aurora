; Ganchos do instalador NSIS.
;
; A pasta de componentes NAO fica mais dentro de $INSTDIR. Numa atualizacao, o
; desinstalador do electron-builder faz `RMDir /r $INSTDIR` antes de o novo
; instalador rodar, e desde que os componentes passaram a ser baixados isso
; apagaria ate 955 MB que o usuario ja tinha. Ela vive em
; $LOCALAPPDATA\SAPHO\components, que a atualizacao nao alcanca, e e o mesmo
; caminho que main/paths.js resolve.

; As pastas do YANC vem inteiras em cada versao e substituem as anteriores, em
; vez de se misturar com elas: copiar por cima deixava o que a versao nova nao
; traz mais, e o appcomp e o cpppp, que sairam na v7.1, seguiam em bin\
; respondendo (issue 213). So apaga a pasta que o instalador traz, para nunca
; deixar o usuario sem ela; e a mesma lista do download-yanc.cts.
!macro SubstituirPastaDoYanc PASTA
  ${If} ${FileExists} "$INSTDIR\resources\components_tmp\${PASTA}\*"
    RMDir /r "$LOCALAPPDATA\SAPHO\components\${PASTA}"
  ${EndIf}
!macroend

!macro customInstall
  ; O instalador traz apenas o que e essencial (Scripts, bin do YANC, SAPHO) em
  ; resources\components_tmp. Copiamos POR CIMA da pasta persistente, para o
  ; que o usuario baixou continuar onde esta. CopyFiles cria o destino se ele
  ; nao existir, entao instalacao nova e atualizacao seguem o mesmo caminho.
  CreateDirectory "$LOCALAPPDATA\SAPHO\components"
  !insertmacro SubstituirPastaDoYanc "bin"
  !insertmacro SubstituirPastaDoYanc "SAPHO"
  !insertmacro SubstituirPastaDoYanc "Header"
  !insertmacro SubstituirPastaDoYanc "Macros"
  ; HDL\ e o nome antigo de SAPHO\, que nenhuma versao traz desde a v5.7.
  RMDir /r "$LOCALAPPDATA\SAPHO\components\HDL"
  CopyFiles /SILENT "$INSTDIR\resources\components_tmp\*.*" "$LOCALAPPDATA\SAPHO\components"
  RMDir /r "$INSTDIR\resources\components_tmp"

  ; Instalacoes antigas deixaram componentes ao lado do executavel. Se houver
  ; algo la, ele e trazido para a pasta nova em vez de ser baixado de novo:
  ; sao centenas de megabytes que ja estao no disco desta maquina.
  ${If} ${FileExists} "$INSTDIR\components\Packages\*"
    CopyFiles /SILENT "$INSTDIR\components\Packages\*.*" "$LOCALAPPDATA\SAPHO\components\Packages"
    RMDir /r "$INSTDIR\components"
  ${EndIf}
!macroend

!macro customUnInstall
  ; Desinstalar de verdade leva os componentes junto; atualizar, nao. Sem esta
  ; distincao, ou a atualizacao apaga o que o usuario baixou, ou a desinstalacao
  ; deixa um gigabyte orfao no perfil dele.
  ${IfNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\SAPHO\components"
    RMDir "$LOCALAPPDATA\SAPHO"

    ; E leva o cache do atualizador junto, pelo mesmo motivo e com a mesma
    ; distincao.
    ;
    ; Ele sobrevivia ao desinstalador, e o sintoma era desconcertante: quem
    ; desinstalava e instalava de novo via o download terminar instantaneo, e
    ; ficava sem saber se tinha baixado alguma coisa. Nao e ilusao, o
    ; electron-updater valida o arquivo em cache e o reaproveita de proposito;
    ; o que estava errado e ele continuar ali depois de a aplicacao ter sido
    ; removida, ocupando centenas de megabytes num perfil que nao tem mais
    ; SAPHO nenhum.
    ;
    ; O nome da pasta vem do campo `name` do package.json, e nao do
    ; productName: e por isso que ele e `sapho-updater` e nao `SAPHO-updater`.
    ; Renomear o `name` move esta pasta e quebra a linha abaixo junto com a
    ; base do delta (ARCHITECTURE.md secao 11).
    ;
    ; Dentro de ${IfNot} ${isUpdated} porque numa ATUALIZACAO este cache e
    ; exatamente o que faz o proximo download ser incremental: apaga-lo ali
    ; custaria o instalador inteiro a cada versao, para o laboratorio todo.
    RMDir /r "$LOCALAPPDATA\sapho-updater"
  ${EndIf}
!macroend
