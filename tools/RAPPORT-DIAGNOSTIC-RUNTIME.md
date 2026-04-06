# RAPPORT DIAGNOSTIC RUNTIME — Background carte Kanban

## Procédure pour obtenir les valeurs réelles

### ÉTAPE 1 — Inspecter en runtime

1. Ouvrir le CRM : `http://localhost:5173/crm.html` (ou votre URL)
2. Se connecter et aller sur **Leads** (vue Kanban)
3. Ouvrir DevTools (F12) → onglet **Console**
4. Coller et exécuter le script dans `tools/diagnostic-console-snippet.js`
5. **OU** manuellement :
   - Sélectionner une carte Kanban (clic droit → Inspecter)
   - Onglet **Computed**
   - Trouver `background` ou `background-color`
   - Copier la valeur exacte
   - Cliquer dessus pour voir la règle source active

### ÉTAPE 2 — Remplir le rapport ci-dessous

---

## RAPPORT STRICT ATTENDU

### Valeurs à remplir (depuis DevTools / script console)

| Champ | Valeur (à remplir) |
|-------|--------------------|
| **Background calculé réel** | |
| **Règle CSS appliquée** | |
| **Fichier** | |
| **Ligne** | |
| **Spécificité** | |

### Cascade complète (règles affectant background sur la carte)

| Sélecteur | background | Fichier | Ligne | Spécificité |
|-----------|------------|---------|-------|-------------|
| `.lead-card` | `#FFFFFF` | solarnext-theme.css | 677 | 0,1,0 |
| `.sn-leads-kanban .lead-card-stage-1` | `#FFFFFF` | solarnext-theme.css | 681 | 0,2,0 |
| `.sn-leads-kanban .lead-card-stage-2` | `#FBF6EB` | solarnext-theme.css | 683 | 0,2,0 |
| `.sn-leads-kanban .lead-card-stage-3` | `#F6EEDC` | solarnext-theme.css | 686 | 0,2,0 |
| `.sn-leads-kanban .lead-card-stage-4` | `#F3E1C2` | solarnext-theme.css | 689 | 0,2,0 |
| `.sn-leads-kanban .lead-card-stage-5` | `#EDF4EC` | solarnext-theme.css | 693 | 0,2,0 |
| `.sn-leads-card` | *(aucun)* | solarnext-theme.css | 699 | 0,1,0 |
| `.sn-leads-kanban-col-X` | *(colonne parente)* | solarnext-theme.css | 642+ | 0,1,0 |

**Note :** `.sn-leads-card` ne définit **pas** `background`. Les colonnes `.sn-leads-kanban-col-X` ont un `background` (dégradé) mais c’est sur le **conteneur**, pas sur la carte.

---

## Conclusion (à compléter après lecture DevTools)

- **Background calculé réel :** *(valeur lue dans Computed)*
- **Règle qui gagne :** *(sélecteur affiché en cliquant sur la valeur dans Computed)*
- **Pourquoi elle gagne :** *(spécificité + ordre dans la cascade)*
- **Règle écrasée :** *(si une règle plus faible est écrasée)*
- **Conclusion racine :** *(résumé)*

---

## Référence source (solarnext-theme.css)

```css
/* Ligne 674-678 */
.lead-card {
  border-radius: 16px;
  padding: 16px;
  background: #FFFFFF;
}

/* Lignes 680-696 */
.sn-leads-kanban .lead-card-stage-1 { background: #FFFFFF; }
.sn-leads-kanban .lead-card-stage-2 { background: #FBF6EB; }
.sn-leads-kanban .lead-card-stage-3 { background: #F6EEDC; }
.sn-leads-kanban .lead-card-stage-4 { background: #F3E1C2; ... }
.sn-leads-kanban .lead-card-stage-5 { background: #EDF4EC; ... }

/* Ligne 699-705 — PAS de background */
.sn-leads-card {
  border-radius: var(--radius);
  padding: var(--spacing-12);
  cursor: pointer;
  ...
}
```
