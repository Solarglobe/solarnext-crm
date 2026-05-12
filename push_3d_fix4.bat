@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
echo Passage temporaire en HTTPS pour le push...
git remote set-url origin https://github.com/Solarglobe/solarnext-crm.git
echo Push commit 394d6be vers GitHub (HTTPS)...
git push origin main
echo.
echo Retour en SSH...
git remote set-url origin git@github.com:Solarglobe/solarnext-crm.git
echo Termine. Appuyez sur une touche pour fermer.
pause
