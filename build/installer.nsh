!include "LogicLib.nsh"
!include "x64.nsh"

!macro customInstall
  ; Stage CP210x even without a connected board. MSP430 USB BSL uses Windows HID.
  SetDetailsPrint both
  DetailPrint "Installing Silicon Labs CP210x USB serial driver..."
  lt700_driver_retry:
    StrCpy $0 -1
    ${DisableX64FSRedirection}
    ExecWait '"$SYSDIR\cmd.exe" /D /S /C ""$SYSDIR\pnputil.exe" /add-driver "$INSTDIR\resources\assets\drivers\CP210x\silabser.inf" /install > "$INSTDIR\driver-install.log" 2>&1"' $0
    ${EnableX64FSRedirection}
    ${If} $0 == 0
      DetailPrint "CP210x driver installed or already available."
    ${ElseIf} $0 == 3010
      SetRebootFlag true
      DetailPrint "CP210x driver installed. Restart Windows before flashing."
    ${ElseIf} $0 == 1641
      SetRebootFlag true
    ${Else}
      DetailPrint "CP210x installation failed (code $0). See $INSTDIR\driver-install.log"
      MessageBox MB_RETRYCANCEL|MB_ICONSTOP "CP210x driver installation failed (code $0). Setup is incomplete.$\r$\n$\r$\nDetails: $INSTDIR\driver-install.log$\r$\n$\r$\nRetry, or cancel and rerun setup after resolving the driver error." /SD IDCANCEL IDRETRY lt700_driver_retry
      SetErrorLevel 1
      Abort "Required CP210x driver installation failed."
    ${EndIf}
  DetailPrint "MSP430 USB BSL uses the Windows built-in HID driver."
!macroend
