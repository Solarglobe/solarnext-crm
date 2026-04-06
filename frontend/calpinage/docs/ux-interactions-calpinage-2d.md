# Spécification UX — Interactions calpinage 2D enrichi (Pan2D / Point2D)

Vue strictement 2D (dessus), précision géométrique maximale, édition des hauteurs sans complexité, lecture claire et usage bureau d’étude. Aucun code, aucune 3D, aucune implémentation UI — description de l’expérience utilisateur et des interactions uniquement.

---

## 1. Organisation générale de l’interface

**Séparation stricte des zones**

L’écran est divisé en deux zones non superposables :

- **Zone carte (canvas / calpinage)** — Occupe la majeure partie de l’écran. Elle affiche la vue de dessus du projet (toiture, contours, pans, panneaux projetés). C’est le seul espace où la géométrie du calpinage est représentée. L’utilisateur y navigue (zoom, pan) et y sélectionne des éléments (pans, sommets). Cette zone ne contient aucun champ de saisie ni panneau de paramètres : elle reste une surface de visualisation et de sélection.
- **Menu latéral gauche** — Zone dédiée aux paramètres, à l’inspection et au contrôle. Toute édition de données (nom du pan, hauteur d’un sommet, contraintes) s’effectue dans ce menu. La carte ne change pas de cadrage, de zoom ni de position lorsque l’utilisateur modifie une valeur dans le menu : le principe est que la manipulation des paramètres n’entraîne jamais de déplacement de la carte.

**Rôle exact du menu gauche**

Le menu gauche assure trois rôles distincts, présentés de façon explicite pour éviter toute confusion :

1. **Inspection** — Lorsqu’un élément est sélectionné sur la carte (ou dans une liste du menu), le menu affiche les informations relatives à cet élément (identifiant, nom, données dérivées, état de cohérence). L’utilisateur consulte sans modifier.
2. **Édition** — Lorsqu’un élément est passé en mode « actif pour édition », le menu propose les champs modifiables (libellé, hauteur, contraintes). La saisie et la validation se font dans le menu ; la carte reflète le résultat après mise à jour, sans bouger.
3. **Contrôle** — Le menu expose les actions globales ou contextuelles (validation d’un pan, verrouillage, annulation) et les indicateurs d’état (erreurs, avertissements). Ces contrôles n’affectent pas la navigation sur la carte.

**Éviter l’ambiguïté entre navigation carte et édition**

- Les actions de **navigation** (zoom, déplacement de la vue) sont déclenchées uniquement dans la zone carte, par des gestes ou des contrôles dédiés (boutons zoom, glisser pour déplacer). Aucun élément du menu gauche ne déclenche de mouvement de la carte.
- Les actions d’**édition** (changer une hauteur, un nom, une contrainte) sont déclenchées uniquement dans le menu gauche. La sélection sur la carte ne suffit pas à éditer : l’utilisateur sélectionne sur la carte, puis édite dans le menu. Ainsi, un clic ou un glissement sur la carte est interprété soit comme navigation, soit comme sélection, jamais comme saisie directe de donnée dans un champ.
- Un état clair (pan non sélectionné / pan sélectionné / pan actif pour édition) est maintenu et affiché ; le menu gauche reflète toujours l’état courant, ce qui évite de croire que l’on édite un pan alors que la sélection a changé.

---

## 2. Sélection et inspection d’un pan

**Sélection d’un pan**

Un pan est sélectionnable de deux manières complémentaires :

- **Sur la carte** — Un clic sur la surface intérieure du pan (ou sur son contour, selon le choix d’affordance) sélectionne ce pan. Un seul pan est sélectionné à la fois ; la sélection d’un autre pan remplace la précédente.
- **Dans le menu gauche** — Une liste (ou arborescence) des pans du projet permet de sélectionner un pan par son nom ou identifiant. La sélection dans la liste équivaut à la sélection sur la carte : le pan concerné est mis en évidence sur la carte et les informations du menu sont mises à jour. Inversement, la sélection sur la carte met en surbrillance l’entrée correspondante dans la liste.

**Comportement visuel à la sélection**

Lorsqu’un pan est sélectionné :

- Son **contour** est mis en évidence (épaisseur, couleur ou style distinct) par rapport aux pans non sélectionnés.
- L’**intérieur** du pan reste lisible (remplissage, panneaux projetés) sans être masqué ; la mise en évidence ne doit pas cacher la géométrie ni les panneaux.
- Les pans non sélectionnés restent visibles avec un style « neutre », de sorte que le contexte du projet reste lisible.

**Informations affichées dans le menu gauche à la sélection**

Dès qu’un pan est sélectionné, le menu gauche affiche :

- **Identifiant et libellé** du pan (nom éditable uniquement en mode édition).
- **Données dérivées en lecture seule** : pente (angle ou pourcentage), orientation (azimut ou libellé cardinal), surface projetée, surface développée — présentées de façon synthétique, sans surcharge.
- **État de cohérence** : indicateur indiquant si le pan est cohérent (géométrie et hauteurs valides) ou non (avec un court message ou code d’erreur).
- **Accès au mode édition** : un moyen explicite (bouton ou entrée de menu) pour passer le pan en « actif pour édition », permettant alors de modifier le libellé, les hauteurs des sommets et les contraintes.

**Différence entre les trois états**

- **Pan non sélectionné** — Aucune mise en évidence particulière sur la carte ; le menu gauche affiche soit une vue d’ensemble du projet (liste des pans, résumé), soit reste vide ou neutre. Aucune donnée technique du pan n’est affichée.
- **Pan sélectionné** — Le pan est mis en évidence sur la carte ; le menu gauche affiche les informations d’inspection (lecture seule) et propose l’entrée en édition. L’utilisateur consulte et décide s’il veut éditer.
- **Pan actif pour édition** — Le pan reste sélectionné et mis en évidence ; le menu gauche bascule sur les champs éditables (nom, sommets avec hauteurs, contraintes). Les sommets du pan peuvent être rendus visibles et sélectionnables pour éditer leurs hauteurs. La sortie du mode édition (validation ou annulation) ramène à l’état « pan sélectionné ».

---

## 3. Visualisation des sommets (Point2D)

**Moment et conditions de visibilité**

Les sommets (Point2D) du pan ne sont pas affichés en permanence. Ils deviennent visibles lorsque :

- Le pan est **actif pour édition** : les sommets du contour du pan sont alors rendus visibles (marqueurs, points ou petits cercles aux coordonnées x, y de chaque Point2D).
- Optionnellement, au **survol du contour** du pan lorsqu’il est sélectionné (ou actif pour édition), les sommets peuvent être soulignés pour faciliter la lecture, sans être obligatoirement cliquables en dehors du mode édition.

En dehors de ces conditions, les sommets ne sont pas dessinés : la carte affiche uniquement le contour du pan et les panneaux projetés, ce qui évite la surcharge visuelle lorsque de nombreux pans sont présents.

**Distinction sommet simple / sommet partagé**

- Un **sommet simple** est un Point2D qui n’appartient qu’à un seul pan. Il est représenté par un marqueur dont la forme ou le style (taille, couleur) indique qu’il est propre à ce pan.
- Un **sommet partagé** est un Point2D référencé par plusieurs pans (arête commune). Il est représenté par un marqueur distinct : forme, symbole ou couleur différente, éventuellement légèrement plus visible, pour signaler que sa modification impactera tous les pans qui le partagent. La légende ou une info-bulle dans le menu gauche rappelle cette convention.

Cette distinction est visible uniquement lorsque les sommets sont affichés (pan actif pour édition, ou survol selon le choix d’affordance).

**Limiter la surcharge visuelle**

- Affichage des sommets **conditionnel** : uniquement pour le pan actif pour édition (et éventuellement au survol du contour en mode sélection).
- **Taille et contraste** des marqueurs restent discrets pour ne pas masquer le contour ni les panneaux ; ils restent néanmoins cliquables et identifiables.
- Lorsque le nombre de sommets est élevé, aucun label texte n’est affiché en permanence sur la carte ; l’identification d’un sommet se fait par sélection (le menu gauche affiche alors l’index, l’id ou la hauteur du sommet sélectionné).

**Mise en évidence du sommet sélectionné**

Lorsqu’un sommet est sélectionné (clic sur le marqueur en mode édition) :

- Ce sommet est **mis en évidence** sur la carte (couleur, taille ou contour renforcé) par rapport aux autres sommets du même pan.
- Le menu gauche affiche les **informations et champs d’édition** de ce sommet (hauteur, contraintes). Ainsi, l’utilisateur voit immédiatement quel point il est en train d’éditer et où il se situe sur le pan.

---

## 4. Édition des hauteurs (Point2D.h)

**Flux utilisateur**

1. **Sélectionner un sommet** — L’utilisateur active le pan pour édition, les sommets apparaissent sur la carte. Il clique sur le marqueur du sommet dont il veut modifier la hauteur. Le sommet est mis en évidence et le menu gauche affiche les données de ce sommet.
2. **Consulter la hauteur actuelle** — Dans le menu gauche, la hauteur actuelle (valeur **h** du Point2D) est affichée en clair (nombre avec unité, ex. mètres). Si le sommet n’a pas encore de hauteur définie, l’affichage l’indique (placeholder ou libellé « non définie »).
3. **Modifier la hauteur** — Le menu gauche propose un moyen d’édition unique et explicite : un **champ numérique** avec unité, complété par des **contrôles incrémentaux** (boutons + / − ou step) pour ajuster la valeur par pas fixe. Un **slider** optionnel peut compléter le champ pour les ajustements rapides dans une plage min–max affichée ou déduite des contraintes. L’édition est **contextualisée** : elle n’apparaît que lorsque le sommet est sélectionné ; en dehors de cette sélection, les champs de hauteur ne sont pas affichés pour les autres sommets, ce qui évite la confusion.
4. **Comprendre l’impact** — Dès que la valeur est modifiée (à la validation du champ ou en temps réel selon le choix d’interaction), la carte est mise à jour : la pente et l’orientation du pan (calculées) changent, ainsi que la projection 2D des panneaux si elle dépend des hauteurs. Aucun chiffre complexe n’est imposé à l’utilisateur : il voit le pan et les panneaux se mettre à jour visuellement ; les grandeurs dérivées (pente, orientation) sont mises à jour dans le menu en lecture seule, de façon synthétique.

**Édition directe ou contextualisée**

L’édition est **contextualisée** : les champs de hauteur ne sont proposés que pour le sommet actuellement sélectionné. L’utilisateur ne saisit jamais une hauteur « en aveugle » : il sélectionne d’abord le point sur la carte (ou dans une liste de sommets du pan dans le menu), puis édite dans le menu. Cela évite les erreurs de cible (modifier le mauvais sommet).

**Éviter les erreurs grossières**

- **Unité et échelle** : l’unité (m par exemple) est affichée à côté du champ ; les pas d’incrément sont cohérents (ex. 0,01 m ou 0,1 m).
- **Contraintes min / max** : si le Point2D possède des contraintes **minH** et **maxH**, le champ et le slider respectent ces bornes ; la saisie d’une valeur hors plage est rejetée ou clampée, avec un retour visuel (message court ou style de champ invalide).
- **Validation** : la valeur est prise en compte à la validation du champ (Entrée ou perte de focus) ou en continu selon le choix du produit ; en cas de valeur invalide (non numérique, hors plage), un message d’erreur court s’affiche dans le menu et la valeur précédente est conservée.

**Gestion des contraintes (lock, min/max)**

- **Verrouillage (lock)** : si le Point2D est marqué comme verrouillé, le champ hauteur est en lecture seule ou désactivé dans le menu ; le sommet reste visible et sélectionnable pour consultation, mais non éditable. Un indicateur (icône ou libellé) signale « sommet verrouillé ».
- **Min / max** : les bornes sont appliquées à la saisie et aux incréments ; le menu peut afficher la plage autorisée (ex. « entre 2,5 m et 5 m ») pour guider l’utilisateur.

---

## 5. Lecture de la pente et de l’orientation (calculées)

**Principe**

La pente et l’orientation du pan sont **toujours calculées** à partir des sommets (x, y, h) ; elles ne sont **jamais saisies** par l’utilisateur. L’interface les **montre** uniquement en lecture.

**Forme d’affichage**

- **Pente** : affichée sous forme de **texte** dans le menu gauche (angle en degrés et/ou pourcentage), lorsque le pan est sélectionné ou actif pour édition. Un **indicateur visuel** optionnel sur la carte (petite flèche ou segment dans le sens de la plus grande pente, ou code couleur discret) peut compléter le texte pour donner une lecture rapide sans surcharger la vue.
- **Orientation** : affichée sous forme de **texte** (azimut en degrés et/ou libellé cardinal : Nord, Nord-Est, etc.) dans le menu gauche. Une **flèche** ou un segment orienté sur la carte peut indiquer la direction de la pente (ou de la normale projetée), uniquement lorsque le pan est sélectionné ou en édition, pour éviter le bruit visuel.

**Moment de visibilité**

- **Au minimum** : pente et orientation sont visibles dans le menu gauche dès que le pan est **sélectionné** (inspection).
- **Sur la carte** : tout indicateur visuel (flèche, code couleur) est affiché uniquement lorsque le pan est sélectionné ou actif pour édition ; il est masqué pour les pans non sélectionnés.
- En **mode édition**, après modification d’une hauteur, les valeurs de pente et d’orientation sont mises à jour immédiatement dans le menu (et éventuellement sur la carte) pour que l’utilisateur comprenne l’impact sans avoir à quitter le mode édition.

**Éviter un tableau de bord d’ingénieur**

- Les grandeurs dérivées (pente, orientation, surfaces) sont présentées de façon **synthétique** : une ligne ou un bloc compact dans le menu, pas un tableau détaillé par défaut.
- Les indicateurs sur la carte restent **discrets** (petite flèche, fine ligne) et ne s’affichent que dans le contexte de sélection/édition. Aucune légende technique permanente n’encombre la vue ; les unités et conventions sont rappelées dans le menu ou dans une aide contextuelle si nécessaire.

---

## 6. Interaction avec les panneaux (projection 2D)

**Apparence des panneaux sur un pan incliné**

Les panneaux sont affichés en **vue de dessus** (projection dans le plan horizontal). Sur un pan incliné, chaque panneau réel (rectangle dans le plan du pan) est représenté par sa **projection 2D** : en général un parallélogramme ou un trapèze, dont la déformation dépend de la pente et de l’orientation du pan (calculées à partir des hauteurs des sommets). L’utilisateur voit donc des formes déformées par rapport à un rectangle, ce qui reflète correctement la géométrie sans passer par une vue 3D.

**Compréhension visuelle de la déformation**

- La **déformation** (réduction d’échelle dans la direction de la pente, cisaillement) est cohérente avec l’inclinaison : plus le pan est pentu, plus les panneaux projetés paraissent « écrasés » ou en trapèze dans le sens de la pente. Une **flèche ou un indicateur de pente** sur le pan sélectionné aide à faire le lien entre la direction de la pente et la déformation des panneaux.
- Aucune explication mathématique n’est demandée à l’utilisateur : la convention est que « ce que l’on voit en vue de dessus est la projection des panneaux posés sur le pan », et l’affichage est fidèle à cette règle.

**Distinction panneau réel / projection vue de dessus**

- Dans l’interface 2D, **tout ce qui est dessiné est en projection vue de dessus**. Il n’y a pas de double représentation (réelle + projetée) sur la même carte pour ne pas créer de confusion. La **surface affichée** (parallélogramme/trapèze) est la projection ; la surface réelle du panneau (dans le plan du pan) est déductible par le calcul (surface développée) et peut être affichée dans le menu en lecture seule (liste des panneaux, surfaces) si besoin.
- La **confiance dans la précision** est assurée par : (1) la cohérence affichée entre contour du pan, hauteurs des sommets et déformation des panneaux ; (2) les grandeurs dérivées (surfaces, pente, orientation) disponibles en lecture dans le menu ; (3) l’absence de vue 3D, qui évite toute ambiguïté sur le référentiel — tout reste dans le même plan 2D horizontal.

---

## 7. Sécurité, validation et erreurs

**Cohérence d’un pan**

Un pan est considéré **cohérent** lorsque : (1) son polygone est fermé et valide (sommets ordonnés, pas de croisement) ; (2) toutes les hauteurs des sommets sont définies (pas de valeur manquante ou invalide) ; (3) les contraintes éventuelles (minH, maxH) sont respectées ; (4) le plan déduit des sommets (x, y, h) permet un calcul de pente et d’orientation valide. L’utilisateur **sait** qu’un pan est cohérent ou non via un **indicateur d’état** dans le menu gauche (icône, couleur ou libellé : « Cohérent » / « Incohérent » ou « À vérifier »), affiché dès que le pan est sélectionné.

**Signalement des incohérences**

- **Incohérence de hauteur** : sommet sans hauteur, ou hauteur hors bornes (min/max). Le menu gauche signale le problème (message court ou liste des sommets concernés) lorsque le pan est sélectionné ou en édition ; les sommets en erreur peuvent être mis en évidence sur la carte (couleur ou style distinct) lorsque les sommets sont visibles (mode édition).
- **Incohérence géométrique** : polygone invalide, sommets dupliqués, ordre incohérent. Un message dans le menu gauche décrit le type d’erreur (sans détail mathématique) et indique que le pan doit être corrigé (par exemple en revenant à la géométrie source ou en ajustant les sommets selon les règles métier).

**Validation et verrouillage du pan**

- **Validation** : une action explicite dans le menu gauche (bouton « Valider le pan » ou équivalent) marque le pan comme vérifié par l’utilisateur. Un pan validé peut être affiché avec un indicateur discret (badge, icône) pour distinguer les pans déjà contrôlés de ceux en cours de saisie. La validation n’est possible que si le pan est cohérent ; sinon, l’action est désactivée ou un message invite à corriger les erreurs.
- **Verrouillage** : une option permet de **verrouiller** le pan (édition des géométries et hauteurs désactivée). Les sommets déjà marqués **lock** restent verrouillés ; le verrouillage du pan entier empêche toute modification du pan tant qu’il n’est pas déverrouillé. Un indicateur dans le menu et éventuellement sur la carte (style ou icône) signale que le pan est verrouillé.

**Éviter les manipulations accidentelles**

- La **sélection** ne modifie pas les données ; seules les actions d’édition dans le menu (champ hauteur, nom, contrainte) modifient le modèle. Un **clic sur la carte** sans entrer en mode édition ne change aucune valeur.
- La **modification des hauteurs** nécessite d’activer le pan pour édition puis de sélectionner un sommet ; les champs ne sont pas éditables en simple survol.
- Les **actions destructives ou à fort impact** (déverrouiller un sommet contraint, réinitialiser des hauteurs) sont placées dans le menu avec un libellé explicite ; un **confirmation** (dialogue court ou double action) peut être demandée pour les opérations critiques selon les règles métier.
- Le **cadrage et le zoom** de la carte ne sont pas modifiés par les changements de paramètres ; l’utilisateur ne perd pas sa position de vue en éditant, ce qui limite les clics par erreur dans la mauvaise zone.

---

*Document : spécification UX des interactions. Aucun code, aucune modification de l’existant, aucune implémentation UI.*
