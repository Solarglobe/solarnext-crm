@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ====================================================
echo   Envoi des corrections RDV vers GitHub
echo   (cela declenche automatiquement le deploiement :
echo    mise a jour de la base + mise en ligne)
echo ====================================================
echo.
echo Modification a envoyer :
git log --oneline -1
echo.
echo Envoi en cours...
git push origin main
echo.
if errorlevel 1 (
  echo ----------------------------------------------------
  echo  L'envoi a echoue. Si une connexion GitHub est
  echo  demandee, reconnecte-toi puis relance ce bouton.
  echo  Envoie-moi le message ci-dessus si besoin.
  echo ----------------------------------------------------
) else (
  echo ----------------------------------------------------
  echo  Envoi reussi ! Le deploiement demarre sur GitHub.
  echo  Il applique la mise a jour de la base puis remet
  echo  l'application en ligne (quelques minutes).
  echo ----------------------------------------------------
)
echo.
echo Appuie sur une touche pour fermer cette fenetre.
pause >nul
