@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
set GIT_SSH_COMMAND=ssh -o StrictHostKeyChecking=accept-new
echo Push commit 394d6be vers GitHub...
git push origin main
echo.
echo Termine. Appuyez sur une touche pour fermer.
pause
