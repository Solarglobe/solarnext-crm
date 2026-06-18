# Audit complet — Module MAIL du CRM

**Date :** 16/06/2026
**Périmètre :** tout l'email — écriture, envoi, brouillons, rendu après envoi, lecture/ouverture, threads, inbox, visuel, sanitisation, synchronisation IMAP, tracking.
**Mode :** audit seul, aucune modification de code (corrections à valider avant exécution).
**Méthode :** lecture de ~30 fichiers front (`frontend/src/pages/mail/**`, hooks lead) + ~30 fichiers back (`backend/routes/mail*`, `backend/services/mail/**`).

---

## 0. Le bug que tu as signalé — CONFIRMÉ (et il est double)

Clic « 📨 Écrire » sur la fiche lead → le composer s'ouvre mais **le champ destinataire reste vide**. Deux défauts cumulés :

**BUG #1 — CRITIQUE — l'email n'est pas transmis au composer**
`frontend/src/hooks/lead/useLeadDetail.ts:1713`
```js
state: { mailComposePrefill: { crmLeadId: leadId, composePresentation: "overlay" } }
```
La fonction reçoit pourtant `addr` (l'email, déjà validé non-vide l.1705-1706) et le type `MailComposerInitialPrefill` prévoit un champ `to`. Il est simplement **oublié**. → Fix : `{ to: addr, crmLeadId: leadId, composePresentation: "overlay" }`.

**BUG #2 — CRITIQUE — le filet de secours lit le mauvais champ JSON**
`frontend/src/pages/mail/MailComposer.tsx:698-699`
```js
const lead = (await res.json()) as { email?: string | null };
const em = typeof lead.email === "string" ? lead.email.trim() : "";
```
Le composer, faute de `to`, va chercher l'email via `GET /api/leads/:id`. Mais l'API renvoie `{ lead: { email } }` (l'email est dans `.lead.email`, pas à la racine). → `em` toujours vide → destinataire jamais rempli. Fix : `const j = await res.json(); const em = (j?.lead?.email ?? j?.email ?? "").trim();`

**Même bug sur un 2ᵉ point d'entrée** : le bouton « Écrire » du portail client (`LeadClientPortalSection.tsx:179-184`) omet aussi `to` → à corriger en même temps.

**Bonne nouvelle :** une fois le destinataire saisi (ou prérempli), il **est bien sauvegardé** (autosave 500 ms + au blur). Le problème est uniquement le pré-remplissage initial.

---

## 1. Synthèse par sévérité

### CRITIQUE
- **#1** Email du lead non transmis au composer (`useLeadDetail.ts:1713`).
- **#2** Fallback composer lit `json.email` au lieu de `json.lead.email` (`MailComposer.tsx:698`).
- **#10** Images intégrées `cid:` jamais affichées → mails reçus « amputés » (logos/signatures/bannières cassés). `mailHtmlSanitize.ts:19-26`, `MailThreadMessage.tsx:184`.
- **#11** Marquage « lu » = N requêtes PATCH + N reconstructions de thread concurrentes sur la même ligne → contention/risque de deadlock, pas d'opération « marquer tout le fil lu ». `mailApi.ts:495`, `mailApi.service.js:830-847`.

### MAJEUR
- **#3** Aucune idempotence d'envoi → double-clic / retry réseau = **double envoi réel**. `mailOutbox.service.js`, `mail.routes.js:258`.
- **#4** Aucune validation d'adresse email côté serveur (seul le front filtre). `smtp.service.js:166`.
- **#5** Jobs outbox bloqués en `sending` si le worker crashe (pas de « reaper ») → mail coincé, ni annulable ni renvoyable. `mailOutbox.processor.js`.
- **#7** Reprise d'un brouillon : la signature par défaut est **ré-injectée de force**, écrasant le choix de l'utilisateur (« Aucune » / signature retirée). `MailComposer.tsx:785-798`.
- **#12** Débordement horizontal du HTML reçu (tableaux/largeurs fixes > 680px) → contenu **rogné** (conteneur en `overflow-x:hidden`). `mail-inbox.css:1389,1483`.
- **#13** Lisibilité en thème sombre : styles inline du mail non isolés → texte foncé sur bulle foncée / blocs blancs. `mail-inbox.css:1931`.
- **#14** Onglets **Spam et Corbeille structurellement vides** : seuls INBOX + SENT sont synchronisés. `mailSync.service.js:38`.
- **#15** Surlignage de recherche faussé par les opérateurs `from:/client:/lead:` (les mots du filtre sont surlignés dans le sujet/snippet). `mailApi.service.js:109`.
- **#16** Overlay (cache `seedDetail`) : marque « lu » côté UI **sans appel backend** → après refresh le fil revient non-lu, compteurs divergents. `MailThreadOverlay.tsx:113-124`.
- **#17** Tracking d'ouverture : faux positifs fréquents (proxys d'images Gmail/Outlook, scanners) → badge « Ouvert » peu fiable. `mailTracking.routes.js:30`.
- **#18** Sync IMAP : les changements d'état serveur (lu/supprimé/déplacé) **ne sont jamais resynchronisés** (high-water-mark sur UID uniquement) → un mail lu sur mobile reste non-lu dans le CRM. `mailSync.service.js:419`.
- **#19** Threading borné par compte → une conversation qui arrive sur info@ puis commercial@ (même org) est **scindée en deux fils**. `mailThreading.service.js:88`.
- **#20** Logs : chaque message importé déverse `raw_headers` complets + flags en clair (`console.info`) → bruit massif + **données personnelles en clair dans les journaux**. `mailSync.service.js:121,315`.
- **#21** HTML reçu : `style` inline non bridé (`position:fixed`, `z-index`) → un mail peut recouvrir l'UI. Pas d'isolation iframe. `mailHtmlSanitize.ts:19`.

### MINEUR
- **#6** Rendu après envoi : profils de sanitisation écriture ≠ affichage → bordures/espacements de tableaux perdus dans le fil. `mailHtmlSanitize.ts`.
- **#8** Brouillon stocké non sanitisé côté serveur (surface XSS latente). `mailDraft.service.js:17`.
- **#9** Validation d'envoi ne neutralise pas la signature → on peut envoyer un mail dont le seul contenu est la signature. `MailComposer.tsx:988`.
- **#22** Snippet inbox : entités HTML non décodées (`r&eacute;ponse`). `mailSyncPersistence.service.js:30`.
- **#23** Badge « X non lus » toujours calculé sur INBOX, même en consultant « Envoyés ». `MailInboxPage.tsx:110`.
- **#24** Lignes de thread = `div role=button` contenant des `<button>` → HTML invalide / focus clavier ambigu (a11y). `MailThreadRow.tsx:93`.
- **#25** Double GET du thread à l'ouverture (viewer + marquage lu). `MailThreadViewer.tsx:233`, `mailApi.ts:509`.
- **#26** Collecte de tracking continue même après désactivation RGPD (seule l'injection est coupée). `mailTracking.service.js:28`.
- **#27** Import initial plafonné à 150 messages/dossier, sans indication « historique tronqué ». `mailSync.service.js:36`.
- **#28** Extrait de recherche coupé en plein mot / multi-octets. `mailSearchHighlight.tsx:35`.

---

## 2. Détail par thème

### A. Écriture / composition
- Pré-remplissage destinataire cassé (#1, #2) — voir §0.
- Signature ré-imposée à la reprise d'un brouillon (#7) : le choix « Aucune signature » n'est pas respecté au rechargement.
- Validation d'envoi : un mail « signature seule » passe (#9).
- Sanitisation à l'écriture : globalement correcte (styles, images, tableaux, `data-signature` conservés) — pas de sur-nettoyage qui casse le rendu.

### B. Envoi
- Pas d'idempotence (#3) : double envoi possible sur double-submit / retry. **Le plus risqué côté image client.**
- Pas de validation email serveur (#4).
- Jobs `sending` orphelins non récupérables si crash worker (#5).
- État d'envoi, file d'attente, suppression du brouillon après succès : OK.

### C. Rendu après envoi
- Divergence de sanitisation écriture vs affichage sur les tableaux (#6) → un tableau rédigé peut s'afficher sans bordures/espacements.
- Pas de double signature détectée à l'affichage (OK).

### D. Brouillons
- Sauvegarde/rechargement nouveau message : OK (brouillon serveur, anti-doublon, purge localStorage).
- Signature ré-injectée (#7) et corps non sanitisé en base (#8).

### E. Lecture / rendu d'un mail ouvert
- **Images `cid:` jamais résolues (#10)** : c'est le défaut visuel le plus visible (mails reçus amputés).
- Débordement horizontal (#12), illisibilité dark mode (#13), `style` inline dangereux (#21).
- Recommandation transverse : rendre le corps dans une **iframe sandbox** (fond blanc forcé, `max-width:100%` images/tables, neutralise `position:fixed` et résout `cid:`) → corrige #10, #12, #13, #21 d'un coup.

### F. État lu / non-lu
- Marquage lu non bulk + rebuilds concurrents (#11).
- Overlay seed passe « lu » sans persistance (#16).
- Double GET (#25), compteurs optimistes transitoires.

### G. Liste inbox / threads
- Spam/Corbeille vides (#14), surlignage recherche faussé (#15), badge non-lus non contextualisé (#23), a11y boutons imbriqués (#24).

### H. Synchronisation IMAP
- Flags serveur non resynchronisés (#18), threading par compte (#19), logs PII verbeux (#20), import initial tronqué silencieux (#27), doublons inter-dossiers latents.

### I. Tracking d'ouverture/clic
- Faux positifs (#17), collecte post-désactivation (#26), réécriture de liens fragile.

---

## 3. Recommandations priorisées (ordre conseillé)

1. **Le bug que tu as signalé (#1 + #2)** — 2 lignes à corriger + le point d'entrée portail client. Rapide, fort impact quotidien.
2. **Envoi : idempotence (#3)** — éviter les doubles envois réels (clé d'idempotence + contrainte unique). Risque image client.
3. **Rendu des mails reçus (#10, #12, #13, #21)** — passer le corps en **iframe sandbox** : résout images cassées, débordement, dark mode et HTML dangereux ensemble.
4. **État lu (#11, #16)** — endpoint serveur « marquer tout le fil lu » (1 transaction) + persister le read-state dans la branche overlay.
5. **Sync (#18, #20)** — resynchroniser les flags ; couper le log des entêtes bruts (PII).
6. **Inbox (#14, #15)** — synchroniser ou masquer Spam/Corbeille ; corriger le surlignage de recherche.
7. **Robustesse envoi (#4, #5)** — validation email serveur + reaper des jobs `sending`.
8. **Finitions (#6, #7, #8, #9, #22-#28)** — signature brouillon, snippet, a11y, tracking RGPD, etc.

---

*Audit réalisé sans modification de code. Donne-moi le feu vert sur les points à corriger (et dans quel ordre) et je m'en occupe avec tests, un lot à la fois.*
