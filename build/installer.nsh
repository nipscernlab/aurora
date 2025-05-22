!macro customInstall 
  Rename "$INSTDIR\resources\saphoComponents_tmp" "$INSTDIR\saphoComponents"

  # Executa o PowerShell com privilégios de administrador
  # ExecShell "runas" 'powershell.exe' '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\saphoComponents\Scripts\add-to-path.ps1"'


  ; Registrar extensão de arquivo .spf
  WriteRegStr HKCR ".spf" "" "SAPHO.ProjectFile"
  WriteRegStr HKCR "SAPHO.ProjectFile" "" "SAPHO Project File"
  WriteRegStr HKCR "SAPHO.ProjectFile\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCR "SAPHO.ProjectFile\shell" "" "open"
  WriteRegStr HKCR "SAPHO.ProjectFile\shell\open" "" "Open with SAPHO"
  WriteRegStr HKCR "SAPHO.ProjectFile\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  
  ; Registrar protocolo sapho://
  WriteRegStr HKCR "sapho" "" "URL:SAPHO Protocol"
  WriteRegStr HKCR "sapho" "URL Protocol" ""
  WriteRegStr HKCR "sapho\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCR "sapho\shell" "" "open"
  WriteRegStr HKCR "sapho\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ; Remover registros de extensão .spf
  DeleteRegKey HKCR ".spf"
  DeleteRegKey HKCR "SAPHO.ProjectFile"
  
  ; Remover registro de protocolo
  DeleteRegKey HKCR "sapho"
!macroend