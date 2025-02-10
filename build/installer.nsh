!macro customInstall
    ExecWait '"$INSTDIR\saphoComponents\Packages\7z2409-x64.exe"'
    ExecWait '"$INSTDIR\saphoComponents\Packages\iverilog-v12-20220611-x64_setup.exe"'
    Rename "$INSTDIR\resources\saphoComponents_tmp" "$INSTDIR\saphoComponents"
!macroend
