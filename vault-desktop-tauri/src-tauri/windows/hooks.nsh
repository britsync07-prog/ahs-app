; This hook runs after the installer has finished copying files
!macro NSIS_HOOK_POSTINSTALL
    ; Create a desktop shortcut
    CreateShortcut "$DESKTOP\${MAINBINARYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend

; This hook runs after the uninstaller has finished removing files
!macro NSIS_HOOK_POSTUNINSTALL
    ; Remove the desktop shortcut
    Delete "$DESKTOP\${MAINBINARYNAME}.lnk"
!macroend
