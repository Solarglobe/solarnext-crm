@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
del /f /q ".git\index.lock" 2>nul
git add frontend/src/modules/calpinage/legacy/calpinage.module.js
git add frontend/src/modules/calpinage/canonical3d/roofExtensions/buildRoofDormerParametric3D.ts
git commit -m "fix(dormer-v2): fond+cotes=0, apex=80cm, labels hauteur en 2D

- Defauts : hWall=0 (pas de murs), hRidge=0.80m (apex 80cm)
- 2D : label 'up80cm' a la pointe du V, '0' aux coins facade
- Panel : 'Cotes (mur)' + 'Apex (pointe)' au lieu de Facade/Faitage
- 3D builder : hFacade=0 -> 4 faces tent (gables+toit), pas de crash"
git push origin main
echo.
echo Done! Press any key to close.
pause
