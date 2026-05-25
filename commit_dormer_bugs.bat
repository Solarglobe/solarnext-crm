@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
del /f /q ".git\index.lock" 2>nul
git add frontend/src/modules/calpinage/legacy/calpinage.module.js
git commit -m "fix(dormer-v2): aretiers diagonaux 2D + ridge centre au quart

- ridge.front.vM : -depth/2 → -depth/4 (entre facade et centre)
- ridge.rear.vM  : +depth/2 → +depth/4 (entre centre et arriere)
  Les aretiers FL→ridgeFront, FR→ridgeFront, RL→ridgeRear, RR→ridgeRear
  sont maintenant DIAGONAUX en vue plan (forme maison reconnaissable).

- Canvas 2D : parois pignon (tirets FL→RL et FR→RR) remplacees par
  4 aretiers pleins diagonaux convergeant vers les 2 apex du faitage.

- Resize front/rear : ridge.front.vM = front + depth/4 (maintenu diagonal)
  ridge.rear.vM = front + depth*3/4 quand arriere bouge."
git push origin main
echo.
echo Done! Press any key to close.
pause
