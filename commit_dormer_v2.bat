@echo off
cd /d "C:\Users\Benoit\Desktop\Solarnext-crm"
del /f /q ".git\index.lock" 2>nul
git add frontend/src/modules/calpinage/legacy/calpinage.module.js
git commit -m "fix(dormer-v2): orientation, ancrage centre, poignees deplacement/resize^

- vAxis corrige : {sinA, -cosA} descend le versant^
- footprint centre sur l ancre : vM dans [-depth/2 ; +depth/2]^
- Helpers V2 : getParametricDormerImagePts, hitParametricDormerHandle^
- getRoofExtensionPointerHit : verifie V2 en priorite^
- beginParametricDormerPointerInteraction : move + edge resize^
- pointermove : blocs parametricDormerMove et parametricDormerEdge^
- Canvas 2D : poignees bleu move + orange bords si dormer selectionne"
git push origin main
echo.
echo Done! Press any key to close.
pause
