!macro customUnInstall
  ; The helper removes only the task carrying this product's exact ownership
  ; description. It never removes a pre-existing development task.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -File "$INSTDIR\resources\runtime-scripts\windows\production-scheduler.ps1" -Action Remove'
  Pop $0
!macroend
