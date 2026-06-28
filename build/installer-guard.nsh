!macro customInstall
  !ifdef ZEROLAG_ENABLE_GUARD_REGISTRATION
    DetailPrint "ZeroLag: installing visible runtime guard service."
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-guard\install-runtime-guard-service.ps1" -ServiceBinary "$INSTDIR\ZeroLag.exe" -AllowElectronWorkerService' $0
    StrCmp $0 0 guard_install_done 0

    DetailPrint "ZeroLag: service install did not complete; registering visible Task Scheduler fallback."
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-guard\install-runtime-guard-task.ps1" -ServiceBinary "$INSTDIR\ZeroLag.exe" -AllowTaskFallbackRegistration' $1

    guard_install_done:
  !endif
!macroend

!macro customUnInstall
  !ifdef ZEROLAG_ENABLE_GUARD_REGISTRATION
    DetailPrint "ZeroLag: removing visible Task Scheduler fallback."
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-guard\uninstall-runtime-guard-task.ps1" -ServiceBinary "$INSTDIR\ZeroLag.exe" -CleanupOnce' $0

    DetailPrint "ZeroLag: removing visible runtime guard service."
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\service-guard\uninstall-runtime-guard-service.ps1" -ServiceBinary "$INSTDIR\ZeroLag.exe" -CleanupOnce' $1
  !endif
!macroend
