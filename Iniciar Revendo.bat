@echo off
setlocal
title Revendo
pushd "%~dp0"
echo ============================================
echo   Revendo - Demarrage...
echo ============================================
echo.
echo Fermez la fenetre de l app pour tout arreter.
echo Ne fermez pas cette fenetre noire pendant l utilisation.
echo.
call npm run dev
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo ============================================
  echo   Une erreur est survenue. Regardez le message ci-dessus.
  echo ============================================
  pause
) else (
  echo Revendo s est ferme correctement.
  timeout /t 3 ^>nul
)
popd
endlocal
