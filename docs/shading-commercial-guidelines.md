# Ombrage — guide commercial (CRM, PDF, discours)

Document **interne** : comment présenter l’ombrage au client et au commercial, sans toucher au moteur physique ni aux contrats JSON/API. Pour la vérité technique et les KPI, voir `docs/shading-kpi-contract.md` et `docs/shading-governance.md`.

## Ce que le client doit comprendre en une phrase

L’**impact ombrage** est une **baisse estimée** de la production photovoltaïque annuelle, due à l’**environnement** : obstacles **proches** du toit et **relief / horizon lointain**. Ce n’est pas un « défaut » du projet : la plupart des toitures ont un impact **> 0 %** ; l’important est de le **situer**, de le **relier** à la production affichée et d’éviter les **comparaisons naïves** entre chiffres partiels.

## Hiérarchie d’affichage recommandée

1. **Synthèse globale** (`combined.totalLossPct` / même règle que `resolveShadingTotalLossPct`) — **chiffre principal** pour le discours vente et la cohérence avec le devis / étude.
2. **Détail** — **proche** puis **lointain**, pour expliquer *d’où* vient la perte (voisinage vs relief). Si le lointain est indisponible (GPS manquant), **ne pas** présenter un 0 % comme « parfait » : expliquer que le **relief n’a pas été calculé**.
3. **Synthèse exposition (modèle)** (overlay DSM) — lecture **composite** (orientation, inclinaison, ombrage modélisé) : **indicateur comparatif**, pas pour remplacer le % global ni une mesure sur site. Le **PDF** expose un **score d’exposition estimé** (0–100) distinct, issu du modèle d’ombrage.

## Cohérence CRM ↔ PDF

- Le **PDF Analyse d’ombrage** utilise les **mêmes résolutions d’affichage** que l’étude pour le total (via `resolveShadingTotalLossPct` côté PDF).
- Les **libellés** ont été alignés sur une lecture **« impact / environnement »** plutôt que « perte » seule, pour réduire l’effet anxiogène tout en restant factuel.
- En **préparation devis technique**, le bloc **Synthèse ombrage (global)** reprend la **même valeur** que le snapshot / quote-prep (`shading_pct` / `total_loss_pct`), alignée sur l’**Impact global estimé** du PDF.

## Ce qu’il ne faut pas faire

- **Ne pas** dire que le projet est « mauvais » sur la seule base d’un % sans le **mettre en perspective** (production absolue, autoconsommation, rentabilité globale).
- **Ne pas** additionner ou confondre **proche**, **lointain** et **global** devant le client : le **global** n’est en général **pas** la somme simple des deux lignes.
- **Ne pas** promettre un ombrage nul : le modèle est **estimatif** ; l’objectif est la **transparence**, pas le « zéro défaut ».
- **Ne pas** surinterpréter le **tableau des modules les plus exposés** : c’est un **classement relatif** sur la pose, pas un diagnostic chantier.

## Arguments utiles en rendez-vous

- « Le **X %** correspond à une **moyenne** sur l’année ; la **carte** montre **où** ça pèse le plus sur les modules. »
- « La partie **lointain** dépend du **relief** et de la **qualité des données** ; quand c’est une **estimation**, on le signale dans l’interface. »
- « La **production** affichée dans l’étude est cohérente avec **cette** prise en compte de l’environnement. » *(Si le commercial n’est pas sûr du pipeline local, rester sur « les chiffres de l’étude et du PDF sont alignés sur le même référentiel produit ».)*

## Near / Far / Global — rappel lecture

- **Near (obstacles proches)** : masques, bâtiments, volumes modélisés près du plan de pose.
- **Far (relief / horizon)** : masque d’horizon à partir du terrain ou d’une estimation si les données sont incomplètes.
- **Global** : **KPI officiel** d’intégration pour l’étude et les documents — toujours le privilégier pour le **chiffre unique** en fin de parcours.

## Maintenance

Toute évolution de **wording** ou de **hiérarchie** d’écran doit :

- rester **alignée** avec ce guide et avec `docs/shading-kpi-contract.md` ;
- mettre à jour les **tests** `test:shading:lock` (copie PDF) et, si besoin, les **tests Playwright** DSM lorsque des chaînes de référence sont assertées.
