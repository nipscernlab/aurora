!macro customInstall
  ; Instalacao nova: components_tmp vira components, como sempre foi.
  ;
  ; Atualizacao: components ja existe e o Rename falharia calado. Antes isso
  ; passava despercebido; com os componentes baixaveis (painel Componentes),
  ; apagar e recriar aqui jogaria fora os Packages que o usuario baixou, ate
  ; 955 MB re-baixados a cada release. A mescla copia por cima so o que o
  ; instalador trouxe (Scripts, bin, HDL) e preserva o resto.
  ${If} ${FileExists} "$INSTDIR\components\*"
    CopyFiles /SILENT "$INSTDIR\resources\components_tmp\*.*" "$INSTDIR\components"
    RMDir /r "$INSTDIR\resources\components_tmp"
  ${Else}
    Rename "$INSTDIR\resources\components_tmp" "$INSTDIR\components"
  ${EndIf}
!macroend
