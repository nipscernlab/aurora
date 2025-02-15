!macro customInstall 
  Rename "$INSTDIR\resources\saphoComponents_tmp" "$INSTDIR\saphoComponents"

  # Executa o PowerShell com privilégios de administrador
  ExecShell "runas" 'powershell.exe' '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\saphoComponents\Scripts\add-to-path.ps1"'

!macroend
