@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
del /f /q ".git\index.lock" 2>nul
git add frontend/src/modules/calpinage/legacy/calpinage.module.js
git commit -m "fix(dormer-v2): 4 aretiers + faitage central = symbole chien assis correct

Le schema montre : V avant (FL+FR->ridgeFront) + ligne faitage centrale
+ V arriere (RL+RR->ridgeRear). Les 4 aretiers etaient corrects, je les
avais retire par erreur. Restaures. Avec depth=1.5m les angles sont a 27deg."
git push origin main
echo.
echo Done! Press any key to close.
pause
