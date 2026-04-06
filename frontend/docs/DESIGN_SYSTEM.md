# Design System SolarGlobe CRM v2 — Premium Dark Principal

## 1. POSITIONNEMENT

**Nom** : SolarGlobe CRM v2 (SolarNext Black Signature)

**Contexte** : CRM SaaS premium pour installateurs photovoltaïques. Identité B2B crédible, technologique, profondeur nette. Violet vivant + doré régulier.

| Attribut | Valeur |
|----------|--------|
| **Identité** | Technologique · Énergétique · Maîtrisé |
| **Pas** | Gaming |
| **Pas** | Luxe doré excessif |
| **Pas** | Neutre fade |
| **Pas** | Beige |

---

## 2. BACKGROUNDS — AUTH vs APP

**Règle** : Jamais de halo sur `body`.

| Token | Usage |
|-------|--------|
| `--bg-app` | Fond principal de l'application CRM |
| `--bg-auth` | Fond page Login (identique, inchangé) |

- **Dark** : `--bg-app` = gradient violet premium discret ; `--bg-auth` = gradient login actuel
- **Light** : `--bg-app` = ivoire chaud (#FBF8F3) ; `--bg-auth` = gradient login (Login reste dark)

**Route** : `html.sn-auth-page` ou `html.sn-app-page` pilote `--bg` pour `body`.

---

## 3. HALOS

**Règle** : Halos sur `.sn-auth-bg` (Login) et `.sn-app-bg` (App), jamais sur `body`.

| Contexte | Halos |
|----------|--------|
| Login (`.sn-auth-bg`) | Haut-gauche + bas-droite (identiques) |
| App (`.sn-app-bg`) | Plus discrets que Login |
| Light mode | Halos app désactivés (`opacity: 0`) |

---

## 4. TOKENS UTILISÉS

### Accents SolarGlobe v2

| Token | Usage |
|-------|--------|
| `--violet-strong` | Boutons, focus |
| `--violet-glow` | Shadow / glow violet |
| `--gold` | Accent premium doré |
| `--gold-soft` | Hover, fonds |

### Surfaces

| Token | Usage |
|-------|--------|
| `--surface-app` | Surface glass / elevated |
| `--surface-card` | Cartes contenu (sn-card-premium) |
| `--surface`, `--surface-2` | Surfaces génériques |

### Textes

| Token | Usage |
|-------|--------|
| `--text-on-light` | Texte sur fond clair |
| `--text-on-dark` | Texte sur fond sombre |
| `--muted-on-light`, `--muted-on-dark` | Texte atténué |

### Bordures

| Token | Usage |
|-------|--------|
| `--border-soft` | Bordure fine |
| `--border-strong` | Bordure marquée |

---

## 5. VARIANTS (Button & Card)

### Button

| Variant | Usage |
|---------|--------|
| `primary` | Violet gradient + glow |
| `premium` | Violet + fine bordure dorée (signature) |
| `ghost` | Transparent, hover gold-soft |
| `outlineGold` | Contour doré, hover gold-soft |
| `danger` | Actions destructives |

### Card

| Variant | Usage |
|---------|--------|
| `default` | sn-card-glass |
| `elevated` | sn-card-elevated |
| `premium` | sn-card-premium (tokens : surface-card, border-soft) |

Login utilise `className="sn-card-premium"` directement.

---

## 6. SIDEBAR — STYLE CARDS

Items de menu en "pill cards" :
- Fond : `--surface-2`
- Bordure : `--border-soft`
- Hover : `--gold-soft`
- Actif : glow violet + liseré doré

**Groupes** : Principal (Leads, Clients, Études, Devis, Documents) ; Administration (Paramètres).

---

## 7. TITRES — .sg-title

- Titre blanc chaud (dark) / noir profond (light)
- Underline dégradé doré discret
- Optionnel : `.sg-title-kicker` violet au-dessus

---

## 8. DARK / LIGHT

- **Dark** : principal
- **Light** : secondaire, fond ivoire chaud, surfaces blanches, halos désactivés

---

## 9. KANBAN CP-035

- Ne pas modifier les colonnes (dégradé chaud validé)
- Lisibilité : cartes / textes / badges via tokens (contraste)
