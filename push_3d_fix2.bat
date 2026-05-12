@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
echo Ajout de la cle github.com dans known_hosts...
ssh-keyscan -H github.com >> "%USERPROFILE%\.ssh\known_hosts" 2>nul
echo Push en cours...
git push origin main
pause
