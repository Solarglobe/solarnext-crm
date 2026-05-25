# Checklist responsive et accessibilite CRM

## Portee

- CRM SolarNext uniquement : navigation, listes, documents, clients, devis/factures, modales et formulaires standards.
- DP, declaration prealable, calculage et calpinage hors scope pour cette passe.
- Largeurs de reference : 390px, 768px, 1024px, 1440px.

## Decision UX

- Desktop 1024/1440 : conserver les tableaux denses et scannables, avec actions secondaires en menus ou boutons icone.
- Mobile 390/768 : basculer les tableaux standards en cartes/lignes empilees, afficher les actions de ligne sans hover obligatoire, et garantir des cibles tactiles de 44px.
- Modales : conserver `ConfirmModal` et `ModalShell` comme primitives, avec focus initial, Escape, `role="dialog"`, `aria-modal` et cycle Tab.

## Checklist

- Navigation mobile : drawer/sidebar ouvrable, focus visible, actions de navigation d'au moins 44px.
- Tables : pas de scroll horizontal non controle sur les listes CRM migrees ; valeurs longues tronquees ou renvoyees a la ligne.
- Modales : utilisables au clavier, boutons pleine largeur sous 480px, focus bloque dans la modale.
- Boutons et menus : cibles tactiles 44px sur mobile, anneau `focus-visible` sur actions critiques.
- Formulaires : inputs et selects lisibles sur mobile, erreurs visibles, pas de libelles techniques.
- Typographie : pas de `font-size` base sur `vw` dans le CRM.

## Verification effectuee

- Route accessible testee en headless sur 390, 768, 1024 et 1440px : pas de debordement horizontal.
- Recherche statique : aucun `font-size` avec `vw` hors DP/calpinage.
- `git diff --check` : OK.

