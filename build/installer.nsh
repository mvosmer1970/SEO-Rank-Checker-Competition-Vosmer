; Included by electron-builder in the NSIS installer (package.json, build.nsis.include).
; Before anything is installed, the installer says whether it updates an installed version or installs anew,
; and the user can cancel. A silent install (/S) asks nothing.

!macro customInit
  IfSilent srtAskDone
  ReadRegStr $R0 SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCmp $R0 "" 0 srtUpdate
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 srtNew
    StrCpy $R0 "(an earlier version)"
  srtUpdate:
    StrCmp $R0 "${VERSION}" srtSame
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "UPDATE$\r$\n$\r$\n${PRODUCT_NAME} $R0 is installed in:$\r$\n$INSTDIR$\r$\n$\r$\nThis will update it to version ${VERSION}.$\r$\nYour projects, research and settings are kept.$\r$\nA running ${PRODUCT_NAME} will be closed.$\r$\n$\r$\nClick OK to update, or Cancel to stop." IDOK srtAskDone
    Quit
  srtSame:
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "REINSTALL$\r$\n$\r$\n${PRODUCT_NAME} ${VERSION} is already installed in:$\r$\n$INSTDIR$\r$\n$\r$\nThis will install the same version again.$\r$\nYour projects, research and settings are kept.$\r$\n$\r$\nClick OK to reinstall, or Cancel to stop." IDOK srtAskDone
    Quit
  srtNew:
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "NEW INSTALLATION$\r$\n$\r$\n${PRODUCT_NAME} is not installed yet.$\r$\nThis will install version ${VERSION} in:$\r$\n$INSTDIR$\r$\n$\r$\nClick OK to install, or Cancel to stop." IDOK srtAskDone
    Quit
  srtAskDone:
!macroend
