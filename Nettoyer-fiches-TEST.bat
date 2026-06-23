@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo.
echo Recherche des fiches clients contenant le mot TEST...
echo.
node scripts\cleanup-test-clients-auto.mjs
echo.
echo ====================================================
echo  Si la liste ci-dessus vous convient, appuyez sur
echo  une touche pour SUPPRIMER les fiches "A SUPPRIMER".
echo.
echo  Pour ANNULER : fermez simplement cette fenetre.
echo ====================================================
echo.
pause
echo.
node scripts\cleanup-test-clients-auto.mjs --apply
echo.
echo Termine. Appuyez sur une touche pour fermer cette fenetre.
pause >nul
