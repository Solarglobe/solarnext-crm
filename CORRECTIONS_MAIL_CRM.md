# Corrections module MAIL — erreur + prompt (28 items)

---

## 1 — Email du lead non transmis au composer
**Erreur :** `frontend/src/hooks/lead/useLeadDetail.ts:1713` — le prefill ne contient pas `to`, alors que `addr` (email validé) est disponible → destinataire vide au clic "Écrire".
**Prompt :** Dans `useLeadDetail.ts`, fonction `openComposeForLeadEmail`, ajoute l'email au prefill : `state: { mailComposePrefill: { to: addr, crmLeadId: leadId, composePresentation: "overlay" } }`. Ne change rien d'autre.

---

## 2 — Fallback composer lit le mauvais champ JSON
**Erreur :** `frontend/src/pages/mail/MailComposer.tsx:698-699` — lit `lead.email` à la racine alors que `GET /api/leads/:id` renvoie `{ lead: { email } }` → email jamais récupéré.
**Prompt :** Dans `MailComposer.tsx`, corrige la lecture de l'email du lead : `const j = await res.json(); const em = (j?.lead?.email ?? j?.email ?? "").toString().trim();`. Garde le `setTo(prev => prev.trim() ? prev : em)`.

---

## 3 — Bouton "Écrire" du portail client omet aussi le destinataire
**Erreur :** `frontend/src/components/leads/LeadClientPortalSection.tsx:179-184` — même oubli de `to` dans le prefill que l'item 1.
**Prompt :** Dans `LeadClientPortalSection.tsx`, au bouton "Écrire", ajoute `to: <email du lead>` dans `mailComposePrefill`, comme pour `openComposeForLeadEmail`.

---

## 4 — Envoi sans idempotence (double envoi possible)
**Erreur :** `backend/services/mail/mailOutbox.service.js` + `backend/routes/mail.routes.js:258` — un double-clic ou un retry réseau crée deux jobs d'envoi → mail envoyé deux fois.
**Prompt :** Ajoute une clé d'idempotence à l'envoi : le front génère un `idempotency_key` (uuid) par tentative d'envoi ; le back ajoute une contrainte unique sur cette clé (table outbox) et renvoie le job existant si la clé est déjà vue, au lieu d'en créer un nouveau. Migration + contrôleur d'envoi.

---

## 5 — Pas de validation d'adresse email côté serveur
**Erreur :** `backend/services/mail/smtp.service.js:166` — aucune validation des adresses destinataires côté back (seul le front filtre).
**Prompt :** Dans la chaîne d'envoi serveur (smtp/outbox), valide chaque adresse destinataire (regex email stricte) avant l'envoi ; rejette le job avec une erreur claire si une adresse est invalide.

---

## 6 — Jobs d'envoi bloqués en "sending" si crash worker
**Erreur :** `backend/services/mail/mailOutbox.processor.js` — un job passé en `sending` reste coincé indéfiniment si le worker crashe (ni renvoyable ni annulable).
**Prompt :** Ajoute un "reaper" : au démarrage du processor (et périodiquement), repère les jobs en `sending` depuis plus de N minutes et repasse-les en `queued` (ou `failed` avec message), pour qu'ils soient repris ou annulables.

---

## 7 — Reprise de brouillon : signature ré-imposée
**Erreur :** `frontend/src/pages/mail/MailComposer.tsx:785-798` — au rechargement d'un brouillon, la signature par défaut est ré-injectée, écrasant le choix "Aucune signature" / signature retirée.
**Prompt :** Dans `MailComposer.tsx`, ne ré-injecte la signature par défaut QUE pour un nouveau message vierge. À la reprise d'un brouillon existant, respecte le contenu (et le choix de signature) tel que sauvegardé, sans ré-imposer la signature.

---

## 8 — Validation d'envoi accepte un mail "signature seule"
**Erreur :** `frontend/src/pages/mail/MailComposer.tsx:988` — la validation ne neutralise pas la signature : on peut envoyer un mail dont le seul contenu est la signature.
**Prompt :** Dans la validation d'envoi de `MailComposer.tsx`, considère le corps comme vide si, après retrait du bloc signature (`data-signature`), il ne reste pas de texte ; bloque l'envoi avec un message dans ce cas.

---

## 9 — Brouillon stocké non sanitisé côté serveur
**Erreur :** `backend/services/mail/mailDraft.service.js:17` — le HTML du brouillon est persisté sans sanitisation (surface XSS latente).
**Prompt :** Dans `mailDraft.service.js`, sanitise le HTML du brouillon à l'enregistrement (même politique que l'envoi), avant insertion en base.

---

## 10 — Rendu après envoi : tableaux perdent bordures/espacements
**Erreur :** `frontend/src/pages/mail/mailHtmlSanitize.ts` — le profil de sanitisation à l'affichage diffère de celui à l'écriture → un tableau rédigé s'affiche sans bordures/espacements dans le fil.
**Prompt :** Aligne la politique de sanitisation d'affichage (`sanitizeMailHtmlDisplay`) sur celle d'écriture pour les tableaux : conserve `border`, `cellpadding`, `cellspacing`, `style` de `table/tr/td/th`. Vérifie qu'un mail envoyé s'affiche identique dans le fil.

---

## 11 — Images intégrées `cid:` jamais affichées
**Erreur :** `frontend/src/pages/mail/mailHtmlSanitize.ts:19-26` + `MailThreadMessage.tsx:184` — DOMPurify supprime les `src="cid:..."` ; aucune réécriture vers une URL servable → logos/signatures/bannières des mails reçus cassés.
**Prompt :** Résous les images inline `cid:` à l'affichage. Soit (préféré) rends le corps dans une iframe sandbox et réécris `cid:<id>` en URL d'attachement servable depuis `attachments[].contentId` ; soit ajoute un hook DOMPurify `uponSanitizeAttribute` qui remplace `src="cid:<id>"` par l'URL `/mail/.../attachments/:id` correspondante. (Cf. item 12 pour l'iframe.)

---

## 12 — Débordement horizontal du HTML reçu (contenu rogné)
**Erreur :** `frontend/src/pages/mail/mail-inbox.css:1389,1483` — un tableau/bloc à largeur fixe > 680px dépasse la bulle ; le conteneur est en `overflow-x:hidden` → colonnes de droite invisibles.
**Prompt :** Rends le corps des mails reçus dans une **iframe sandbox** (sans `allow-same-origin`), fond blanc forcé, avec un CSS injecté `img,table{max-width:100%!important;height:auto} table{table-layout:auto}`. Ça contient le HTML tiers, corrige le débordement (12), l'illisibilité dark mode (13), le `style` dangereux (21) et permet de résoudre les `cid:` (11).

---

## 13 — Illisibilité en thème sombre
**Erreur :** `frontend/src/pages/mail/mail-inbox.css:1931` — la règle force seulement la couleur du conteneur ; les styles inline du mail (texte foncé/fond blanc) priment → dark-on-dark ou bloc blanc.
**Prompt :** Isole le rendu du mail sur un fond clair neutre (via l'iframe de l'item 12, fond blanc), pour que les couleurs inline du mail restent lisibles quel que soit le thème de l'app.

---

## 14 — `style` inline non bridé (recouvrement d'UI)
**Erreur :** `frontend/src/pages/mail/mailHtmlSanitize.ts:19` — `style` inline conservé sans filtre : un mail peut injecter `position:fixed`/`z-index` élevé et recouvrir l'interface.
**Prompt :** Soit via l'iframe sandbox (item 12, isole tout), soit en filtrant dans la sanitisation les propriétés `position`, `z-index`, `top/left/right/bottom` des `style` inline des mails affichés.

---

## 15 — Onglets Spam et Corbeille structurellement vides
**Erreur :** `backend/services/mail/mailSync.service.js:38` — `FOLDER_TYPES_TO_SYNC = ["INBOX","SENT"]` : Spam/Trash jamais synchronisés, donc les onglets affichent toujours "Aucun email".
**Prompt :** Choisis une option et applique-la : (a) ajoute TRASH et SPAM/JUNK à `FOLDER_TYPES_TO_SYNC` + mapping `imap.mailbox-map.js` ; ou (b) masque les onglets "Spam" et "Corbeille" dans `MailInboxPage.tsx` tant qu'ils ne sont pas synchronisés.

---

## 16 — Surlignage de recherche faussé par `from:/client:/lead:`
**Erreur :** `backend/services/mail/mailApi.service.js:109-114` — les mots des opérateurs de champ sont versés dans `highlightTerms` → surlignés à tort dans sujet/snippet.
**Prompt :** Dans `mailApi.service.js`, ne mets dans `highlightTerms` que les mots du **texte libre** de la recherche, pas les valeurs des opérateurs `from:`, `to:`, `client:`, `lead:`.

---

## 17 — Marquage "lu" = N requêtes + N rebuilds concurrents
**Erreur :** `frontend/src/services/mailApi.ts:495` + `backend/services/mail/mailApi.service.js:830-847` — un PATCH par message non lu, chacun déclenchant `rebuildThreadMetadata` sur la même ligne thread → contention/risque de deadlock, pas de bulk.
**Prompt :** Crée un endpoint serveur `POST /mail/threads/:id/read` qui marque tous les messages entrants du fil comme lus et fait **un seul** `rebuildThreadMetadata`, le tout dans une transaction. Remplace côté front la boucle `Promise.all` de PATCH par cet appel unique.

---

## 18 — Overlay (seedDetail) : "lu" en UI sans persistance backend
**Erreur :** `frontend/src/pages/mail/MailThreadOverlay.tsx:113-124` — la branche cache marque lu en local et met à jour les compteurs UI mais n'appelle jamais `markInboundMessagesAsRead` → après refresh, fil non-lu, compteurs faux.
**Prompt :** Dans la branche `seedDetail` de `MailThreadOverlay.tsx`, appelle aussi la persistance backend (endpoint de l'item 17, ou `markInboundMessagesAsRead`) comme le fait la branche réseau.

---

## 19 — Faux positifs de tracking d'ouverture
**Erreur :** `backend/routes/mailTracking.routes.js:30-50` — tout GET sur le pixel marque `opened_at` ; les proxys d'images (Gmail/Outlook) et scanners préchargent → badge "Ouvert" peu fiable.
**Prompt :** Dans le endpoint pixel, filtre les ouvertures : ignore les User-Agent de proxys/scanners connus (GoogleImageProxy, etc.), ignore une ouverture dans les premières secondes après envoi, et n'enregistre qu'une première ouverture significative. Documente la limite résiduelle.

---

## 20 — Sync IMAP : flags serveur jamais resynchronisés
**Erreur :** `backend/services/mail/mailSync.service.js:419-429` — sync incrémentale par `uid > maxUidDb` uniquement : lu/supprimé/déplacé côté serveur jamais reflété → mail lu sur mobile reste non-lu dans le CRM.
**Prompt :** Ajoute une resynchronisation des flags des UID déjà connus (re-fetch des `\Seen`/flags, ou CONDSTORE/QRESYNC si supporté) pour mettre à jour l'état lu/non-lu et les suppressions des messages existants, en plus de l'import des nouveaux UID.

---

## 21 — Threading borné par compte (conversations scindées)
**Erreur :** `backend/services/mail/mailThreading.service.js:88-131,219` — toutes les recherches in-reply-to/references/message-id/sujet filtrent `mail_account_id` → un fil sur info@ puis commercial@ (même org) se dédouble.
**Prompt :** Dans `mailThreading.service.js`, élargis la résolution de fil au niveau **organisation** (ou groupe de comptes partagés) plutôt que strictement `mail_account_id`, pour relier les messages d'une même conversation reçus sur des comptes différents de l'org.

---

## 22 — Logs : entêtes bruts + données perso en clair
**Erreur :** `backend/services/mail/mailSync.service.js:121-131,315-318` — `logMailMessagesJsonbInsert` déverse `raw_headers` complets et flags via `console.info` pour chaque message → bruit massif + PII dans les journaux.
**Prompt :** Supprime ou abaisse `logMailMessagesJsonbInsert` : ne logge plus `raw_headers`/contenu ; conserve au plus un compteur (`N messages importés`) derrière un garde de niveau debug.

---

## 23 — Snippet inbox : entités HTML non décodées
**Erreur :** `backend/services/mail/mailSyncPersistence.service.js:30-38` — `snippetFromBodies` strippe les balises sans décoder les entités → "r&eacute;ponse&nbsp;client" dans la liste.
**Prompt :** Dans `snippetFromBodies`, décode les entités HTML (`&eacute;`, `&nbsp;`, `&amp;`, …) après suppression des balises, avant de tronquer le snippet.

---

## 24 — Badge "non lus" non contextualisé au dossier
**Erreur :** `frontend/src/pages/mail/MailInboxPage.tsx:110-117` — le résumé non-lus est toujours calculé sur `inbox`, même en consultant "Envoyés".
**Prompt :** Dans `MailInboxPage.tsx`, calcule le résumé "non lus" sur le **dossier courant** (mailbox sélectionnée), ou masque le badge "X non lus" hors INBOX.

---

## 25 — Lignes de thread : boutons imbriqués (a11y / HTML invalide)
**Erreur :** `frontend/src/pages/mail/MailThreadRow.tsx:93-157` — un `div role="button" tabIndex=0` contient des `<button>` "Lu"/"Archiver" → DOM invalide, focus clavier ambigu.
**Prompt :** Refactore `MailThreadRow.tsx` pour éviter les contrôles interactifs imbriqués : sépare la zone cliquable (ouverture) des boutons d'action (stopPropagation), sans `<button>` dans un élément `role="button"`.

---

## 26 — Double GET du thread à l'ouverture
**Erreur :** `frontend/src/pages/mail/MailThreadViewer.tsx:233-245` + `frontend/src/services/mailApi.ts:509-512` — `getThread` est appelé deux fois (affichage + marquage lu).
**Prompt :** Mutualise : réutilise le thread déjà chargé par le viewer pour le marquage lu (passe les ids déjà connus) au lieu de refaire un `getThread`.

---

## 27 — Tracking : collecte persiste après désactivation RGPD
**Erreur :** `backend/services/mail/mailTracking.service.js:28-30` — les endpoints pixel/clic n'évaluent jamais le flag `isMailTrackingEnabled` → la collecte continue sur les anciens `tracking_id` même après désactivation.
**Prompt :** Dans les endpoints de tracking (pixel + clic), vérifie `isMailTrackingEnabled` pour l'org avant d'enregistrer ouverture/clic ; si désactivé, ne stocke rien (redirige juste pour les clics).

---

## 28 — Import initial tronqué à 150 sans indication
**Erreur :** `backend/services/mail/mailSync.service.js:36,428` — `INITIAL_IMPORT_LIMIT=150` par dossier, sans signal UI → l'historique ancien paraît "manquant".
**Prompt :** Soit augmente/rends configurable `INITIAL_IMPORT_LIMIT`, soit ajoute un indicateur UI "historique limité aux N derniers messages" + une action "charger plus ancien".
