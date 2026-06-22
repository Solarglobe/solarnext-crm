# Refonte juridique — PDF devis + CGV SolarGlobe

**Objet :** réécriture du contenu contractuel (mentions du devis PDF + CGV) pour aligner les textes sur la séparation A/B/C (SolarGlobe = vente matériel + accompagnement ; pose = installateur RGE indépendant, devis séparé). Aucune logique métier, aucun calcul, aucun total, aucune structure backend n'est modifié.

> ⚠️ **AVERTISSEMENT IMPORTANT — ce document n'est pas un avis juridique.**
> Je ne suis pas avocat. Ces textes sont une proposition de rédaction destinée à **réduire l'exposition** de SolarGlobe et à refléter le positionnement demandé. Ils doivent impérativement être **relus et validés par un avocat** (droit de la consommation / construction), et certains points par votre **assureur** (RC pro, périmètre couvert) et votre **comptable/fiscaliste** (TVA). Voir la Partie 4 « Points à faire valider ».

---

## PARTIE 1 — Mentions du PDF devis

### 1.1 Mention au-dessus des signatures (PRIORITÉ) — déjà intégrée au template

Texte affiché juste au-dessus du bloc « Bon pour accord / signatures » lorsque le devis comporte une ligne pose (section B) :

> « La signature du présent devis engage exclusivement le Client pour les prestations de la section A, soit le montant facturé par SolarGlobe. Elle ne vaut ni commande ni acceptation de la prestation de pose décrite en section B, laquelle fera l'objet d'un devis distinct conclu directement entre le Client et l'installateur RGE indépendant. Le coût global indiqué en section C est purement indicatif et ne constitue pas le montant facturé par SolarGlobe. »

*(Intégré dans `QuoteDocumentView.tsx`, encadré visible. Cf. Partie 5.)*

### 1.2 Bloc « Informations réglementaires & conformité » (à coller dans Organisation → Catalogue devis → Document PDF)

Ce bloc est un **paramètre d'organisation** (texte éditable), pas du code. Remplacer le texte actuel par :

> **Conformité et répartition des prestations.** Le matériel photovoltaïque est conforme aux normes en vigueur. Les prestations de pose, de raccordement électrique d'exécution, de mise en service technique et de vérification sur chantier relèvent de l'installateur RGE indépendant. Elles ne sont ni réalisées, ni facturées, ni encaissées par SolarGlobe et feront l'objet d'un devis séparé conclu directement entre le Client et l'installateur.
>
> La réalisation de la pose est conditionnée à l'acceptation du devis distinct de l'installateur, à la faisabilité technique confirmée par celui-ci et à la remise des justificatifs professionnels nécessaires (notamment qualification RGE/QualiPV et attestation d'assurance décennale couvrant les travaux photovoltaïques, lorsque applicable).
>
> SolarGlobe intervient au titre de la vente du matériel, de l'étude prévisionnelle, du dimensionnement commercial, de l'accompagnement administratif et de la coordination commerciale et documentaire du dossier.

### 1.3 Délais / livraison / exécution (à ajouter au devis ou dans le bloc conformité)

> **Délais prévisionnels.** Livraison du matériel : délai prévisionnel indiqué au devis (généralement 2 à 8 semaines après commande ferme). Accompagnement administratif SolarGlobe : engagé dès la commande. Le délai de pose dépend du devis et du planning de l'installateur RGE indépendant et n'est pas garanti par SolarGlobe.

---

## PARTIE 2 — CGV complètes réécrites

> Document destiné à remplacer `CGV-SolarGlobe-2026-06-10-v3.pdf` après validation avocat (à convertir en PDF puis ré-uploader dans Organisation → CGV). Les articles non listés en Partie 3 sont conservés quasi à l'identique.

---

**SOLARGLOBE — Conditions Générales de Vente**
SAS SolarGlobe au capital de 30 000 € — 19 avenue Pierre Curie, 77500 Chelles — RCS Meaux 988 455 416 — TVA : FR18988455416
Dernière mise à jour : [DATE À METTRE À JOUR]

### ARTICLE 1 — Champ d'application et acceptation
*(inchangé)*

1.1. SolarGlobe est une SAS au capital de 30 000 €, siège 19 avenue Pierre Curie, 77500 Chelles, RCS Meaux 988 455 416, TVA FR18988455416. SolarGlobe propose la **vente de matériel photovoltaïque et l'accompagnement de projets solaires** à destination des particuliers en France métropolitaine. Les présentes CGV s'appliquent à toute commande de matériel ou prestation d'accompagnement auprès de SolarGlobe.

1.2. Toute demande de devis ou commande implique l'acceptation pleine et entière des CGV. Les CGV applicables sont celles en vigueur à la date de signature du devis/bon de commande.

### ARTICLE 2 — Champ d'intervention de SolarGlobe *(réécrit)*

SolarGlobe intervient comme **vendeur de matériel photovoltaïque et accompagnateur de projet solaire**. Son intervention porte sur l'étude prévisionnelle, le dimensionnement commercial, la sélection et la fourniture du matériel, l'accompagnement administratif, la préparation du dossier, la mise en relation avec un installateur RGE indépendant, et la coordination commerciale et documentaire entre les parties.

Cette coordination ne constitue **ni une mission de maîtrise d'œuvre, ni une mission de bureau d'étude d'exécution, ni une mission de contrôle technique, ni une direction de travaux.**

La pose des panneaux, le raccordement électrique d'exécution au tableau, la mise en service technique et les vérifications sur chantier sont réalisés par un **installateur RGE indépendant**, dans le cadre d'un **contrat séparé conclu directement avec le Client**. Ces prestations ne sont ni réalisées, ni facturées, ni encaissées par SolarGlobe.

SolarGlobe assure au Client un point d'entrée pour les éléments qu'elle fournit et facture (matériel, étude, accompagnement administratif, suivi sur son périmètre) et peut, à titre de facilitation, orienter le Client vers l'intervenant compétent, sans se substituer aux obligations, responsabilités et assurances propres à l'installateur.

> NB : la **demande administrative de raccordement** auprès du gestionnaire de réseau peut être accompagnée par SolarGlobe au titre des démarches administratives ; le **raccordement électrique d'exécution** (câblage, tableau) relève de l'installateur.

### ARTICLE 3 — Processus de commande *(réécrit)*

1. **Étude prévisionnelle et devis SolarGlobe** (section A — prestations facturées par SolarGlobe ; section B — estimation indicative de la pose installateur ; section C — coût global indicatif).
2. **Signature du devis SolarGlobe** valant commande **uniquement pour la section A**.
3. **Établissement et signature du devis distinct de l'installateur RGE** pour la section B (pose).
4. **Réalisation de la pose** uniquement après accord conclu entre le Client et l'installateur.
5. SolarGlobe **accompagne le suivi documentaire et client sur son propre périmètre**.

En l'absence de signature du devis distinct de l'installateur RGE, **aucune prestation de pose ne peut être engagée**.

Le montant de pose figurant en section B du devis SolarGlobe est une **estimation indicative**. Le prix définitif de la pose est celui indiqué sur le devis établi par l'installateur RGE indépendant.

### ARTICLE 4 — Prix *(réécrit)*

Les prix facturés par SolarGlobe correspondent **exclusivement** aux prestations et fournitures mentionnées en **section A** du devis, indiqués en euros. Les montants mentionnés en **section B** au titre de la pose par installateur RGE indépendant sont **indicatifs et ne sont pas inclus** dans le prix facturé par SolarGlobe. Le **coût global** de la section C est purement **indicatif** (addition section A + estimation section B) et ne constitue pas le montant facturé par SolarGlobe.

Les prix SolarGlobe sont confirmés par devis, valable 1 mois. Toute prestation complémentaire non incluse sera chiffrée séparément.

### ARTICLE 5 — Paiement *(réécrit)*

**5.1.** Tout échéancier mentionné au devis SolarGlobe est calculé **exclusivement sur le montant facturé par SolarGlobe (section A)**, jamais sur le coût global indicatif (section C).

**5.2.** Structure type (le devis prévaut) : acompte à la commande, échéance(s) intermédiaire(s) éventuelle(s), solde après validation du CONSUEL. L'acompte est encaissé après expiration du délai légal applicable aux contrats conclus hors établissement (cf. article 12).

**5.3.** La prestation de pose est **réglée directement par le Client à l'installateur RGE indépendant**, selon les modalités prévues dans le devis séparé de celui-ci. **SolarGlobe n'encaisse aucune somme au titre de la pose** et n'intervient pas dans la relation financière Client–installateur.

**5.4. Financement.** SolarGlobe peut orienter le Client vers un courtier/solution de financement partenaire ; le recours au crédit est optionnel.

**5.5. Retard de paiement.** En cas de retard sur une échéance SolarGlobe, après mise en demeure restée sans effet 8 jours, SolarGlobe peut suspendre ses prestations et appliquer les pénalités au taux légal (cf. article 11).

### ARTICLE 6 — Transfert des risques et de propriété — réception du matériel
*(inchangé — réserve de propriété jusqu'au paiement intégral SolarGlobe ; réception matériel : 3 jours transport / 7 jours autres anomalies ; sans préjudice des garanties légales)*

### ARTICLE 7 — Accès Internet
*(inchangé)*

### ARTICLE 8 — Pose toiture par installateur RGE indépendant *(réécrit — article clé)*

La pose des panneaux, le raccordement électrique d'exécution, la mise en service technique sur chantier et les vérifications de l'installation sont réalisés par un **installateur RGE indépendant**, dans le cadre d'un **devis séparé** conclu et réglé **directement entre le Client et cet installateur**.

SolarGlobe, à ce titre :
- **ne réalise pas** la pose ;
- **ne sous-traite pas** la pose ;
- **ne facture pas** la pose ;
- **ne dirige pas** les travaux (pas de maîtrise d'œuvre ni de direction de chantier) ;
- **ne réceptionne pas** juridiquement les travaux à la place du Client.

L'installateur RGE indépendant assume la pose, le raccordement d'exécution, la mise en service technique, les vérifications et **les garanties et assurances attachées à ses travaux** (notamment RGE/QualiPV et garantie décennale photovoltaïque lorsque applicable). Il reste **seul responsable de ses travaux**.

La **réception des travaux de pose** est effectuée **entre le Client et l'installateur** ; un procès-verbal ou document de réception distinct peut être établi par l'installateur.

SolarGlobe peut **faciliter les échanges** entre le Client et l'installateur, **sans se substituer** aux obligations contractuelles, techniques, assurantielles ou décennales de ce dernier.

**Continuité — cessation d'activité de l'installateur.** Les garanties et assurances attachées aux travaux relèvent du contrat de l'installateur et de ses polices. En cas de cessation d'activité de l'installateur, le Client conserve ses droits et voies de recours ; SolarGlobe peut, à titre de facilitation et sous réserve de faisabilité, aider à identifier un nouvel intervenant qualifié, sans prise en charge juridique des travaux.

### ARTICLE 9 — Suivi, SAV et garanties *(réécrit)*

**Périmètre SolarGlobe :** garanties légales sur les produits qu'elle vend, relation avec les fabricants/fournisseurs si nécessaire, accompagnement documentaire, et suivi du Client sur son propre périmètre.

**Périmètre installateur RGE :** SAV de la pose, défauts de pose, infiltrations, tenue mécanique, raccordement d'exécution, mise en service technique, conformité du chantier, ainsi que la décennale et la RC liées aux travaux.

Pour les désordres relevant de la pose, du raccordement d'exécution ou de la mise en service technique, le **Client sollicite l'installateur RGE indépendant** ; SolarGlobe peut uniquement faciliter l'orientation de la demande.

Les garanties fabricants et les garanties légales applicables aux produits vendus demeurent régies par les contrats et documents remis au Client, indépendamment de la pérennité de l'accompagnement commercial.

### ARTICLE 10 — Maintenance & dépannage
*(inchangé)*

### ARTICLE 11 — Résiliation et annulation *(réécrit — suppression des clauses à risque)*

**11.1. Défaut de paiement / inexécution.** En cas de défaut de paiement d'une échéance SolarGlobe ou d'inexécution grave, le devis/bon de commande peut être résilié après mise en demeure restée sans effet 8 jours.

**11.2. Annulation par le Client (hors rétractation).** En cas d'annulation par le Client après expiration du délai légal de rétractation, SolarGlobe pourra **facturer ou conserver les sommes correspondant aux prestations effectivement réalisées, aux frais engagés et aux commandes irrévocablement passées, sous réserve de justification.** Aucune somme n'est acquise de manière automatique ou forfaitaire au-delà de ce qui est justifié.

**11.3.** Cette clause **ne limite pas les droits du Client** en cas d'inexécution, de retard grave, de non-conformité, de faute de SolarGlobe, ni aucun droit impératif applicable. Les cas de force majeure dûment justifiés n'ouvrent droit à aucune indemnité de part ni d'autre.

> *(Supprimé : « le refus administratif définitif est la seule cause d'annulation », « le premier acompte reste intégralement acquis » de manière automatique, et la clause 11.3 d'origine.)*

### ARTICLE 12 — Droit de rétractation *(réécrit — prudence B2C, contrat mixte)* — **À FAIRE VALIDER PAR AVOCAT**

Le Client consommateur dispose d'un **délai de rétractation de 14 jours** dans les conditions du Code de la consommation.

- **Vente de biens** (matériel) : le délai court à compter de la **réception** du bien par le Client.
- **Prestations de services** (étude, accompagnement) : le délai court à compter de la **conclusion** du contrat.
- **Exécution anticipée** d'une prestation de services avant la fin du délai : uniquement sur **demande expresse** du Client, qui est alors informé qu'en cas de rétractation il devra payer le service fourni jusqu'à la rétractation.
- Pour les contrats conclus **hors établissement**, aucun paiement ne peut être exigé avant un délai de **7 jours** à compter de la conclusion (article L221-10 du Code de la consommation).
- La rétractation s'exerce par tout moyen écrit ou via le **formulaire en annexe**. Remboursement sous 14 jours à compter de la réception de la demande.

> *(Supprimé : « 14 jours à compter de la signature » générique et « sauf renonciation expresse du Client » globale.)*

### ARTICLE 13 — Garanties légales *(développé)*

**13.1. Garantie légale de conformité** (art. L217-3 s. Code de la consommation) : SolarGlobe répond des défauts de conformité du matériel vendu existant à la délivrance. Le Client peut obtenir la **mise en conformité** par réparation ou remplacement, à défaut une **réduction du prix** ou la **résolution** de la vente, dans les conditions et délais légaux.

**13.2. Garantie des vices cachés** (art. 1641 s. Code civil) : le Client peut agir au titre des vices cachés du matériel et obtenir, à son choix, la résolution de la vente ou une réduction du prix.

**13.3. Garanties commerciales fabricants** (ex. 25 ans modules ; 2 à 25 ans onduleurs/batteries selon marques), précisées au devis et à la documentation produit. **Ces garanties commerciales n'excluent pas les garanties légales** ci-dessus.

**13.4. Répartition.** Les garanties portées par SolarGlobe concernent **le matériel qu'elle vend** ; les garanties relatives aux **travaux** (pose, raccordement d'exécution, mise en service technique, étanchéité, décennale) relèvent de **l'installateur RGE indépendant**.

**13.5. Estimations de production/rentabilité** : projections prévisionnelles, sans engagement de résultat ; la production réelle dépend de facteurs extérieurs (météo, ombrages, consommation, tarifs). Les garanties de puissance des fabricants demeurent applicables.

### ARTICLE 14 — Données personnelles (RGPD) *(développé)*

- **Responsable de traitement :** SAS SolarGlobe (coordonnées ci-dessous).
- **Données collectées :** identité, coordonnées, adresse du site, données du projet (consommation, caractéristiques techniques), données de facturation.
- **Finalités :** établissement des devis et de l'étude, gestion de la commande et des garanties, accompagnement administratif, mise en relation avec l'installateur, suivi client, obligations légales et comptables.
- **Bases légales :** exécution du contrat / mesures précontractuelles, obligations légales, intérêt légitime, et consentement pour la prospection le cas échéant.
- **Destinataires :** services internes SolarGlobe, installateur RGE et partenaires strictement nécessaires (financement, raccordement, administratif), sous-traitants techniques, autorités lorsque la loi l'exige.
- **Durée de conservation :** durée de la relation contractuelle puis durées légales de prescription et obligations comptables.
- **Droits du Client :** accès, rectification, effacement, limitation, opposition, portabilité ; réclamation auprès de la CNIL.
- **Contact :** contact@solarglobe.fr.

*(Ou : renvoi vers une Politique de confidentialité accessible en ligne reprenant ces éléments.)*

### ARTICLE 15 — Propriété intellectuelle
*(inchangé)*

### ARTICLE 16 — Responsabilité *(réécrit — resserré au périmètre réel)*

SolarGlobe est responsable, dans les conditions du droit commun et des garanties légales : **des produits qu'elle vend, des informations qu'elle fournit, des prestations qu'elle facture, et des fautes prouvées dans son accompagnement.**

SolarGlobe **n'est pas responsable** : de la pose et des travaux de toiture, du raccordement électrique d'exécution, de la mise en service technique réalisée sur chantier par l'installateur, des désordres relevant du contrat de l'installateur, des dommages causés par une intervention extérieure non validée, ni des **performances réelles** dépendant de conditions extérieures.

La présente clause **limite la responsabilité de SolarGlobe à son périmètre réel** ; elle ne saurait exclure la responsabilité légale de SolarGlobe pour les prestations et produits relevant de son périmètre, ni écarter les droits impératifs du Client consommateur.

### ARTICLE 17 — Recyclage et fin de vie
*(inchangé)*

### ARTICLE 18 — Autonomie des clauses et non-renonciation
*(inchangé)*

### ARTICLE 19 — Sous-traitance *(réécrit)*

SolarGlobe peut confier à des partenaires/sous-traitants agréés certaines prestations relevant de **son périmètre administratif, documentaire ou de support**, tout en restant l'interlocuteur du Client pour les prestations qu'elle facture. **La pose n'est pas une sous-traitance de SolarGlobe** : elle fait l'objet d'un **contrat séparé conclu directement entre le Client et l'installateur RGE indépendant**, qui la réalise et la facture.

### ARTICLE 20 — Loi applicable, juridiction, médiation *(corrigé)*

Droit français. En cas de litige, le Client s'adresse d'abord au service clients SolarGlobe. À défaut de solution amiable, le Client consommateur peut recourir gratuitement à la médiation de la consommation auprès de : **[médiateur — À CONFIRMER]** *(n'indiquer CM2C que si l'adhésion de SolarGlobe est effective et à jour ; sinon indiquer le médiateur réellement souscrit).*

> *(Supprimé : le lien vers la plateforme européenne ODR — `ec.europa.eu/consumers/odr` — la plateforme ayant été fermée par la Commission européenne le 20 juillet 2025.)*

### ARTICLE 21 — Modification des CGV
*(inchangé)*

### ARTICLE 22 — Service client & contact
*(inchangé : 19 avenue Pierre Curie 77500 Chelles ; contact@solarglobe.fr ; +33 1 72 99 47 53 ; RCS Meaux 988 455 416 ; SIRET 988 455 416 00012)*

### ANNEXE — Formulaire de rétractation
*(conservé)* — à compléter par le Client : n° de devis/bon de commande, nom, adresse, date, signature ; adressé à SOLARGLOBE (contact@solarglobe.fr ou adresse postale).

---

## PARTIE 3 — Résumé article par article des corrections

| Élément | Avant (à risque) | Après (corrigé) |
|---|---|---|
| **Mention signatures** | absente | Mention « engage section A uniquement » ajoutée au-dessus des signatures |
| **Bloc conformité** | vague | Pose/raccordement exéc./MES/vérif = installateur ; non facturé/encaissé SolarGlobe ; conditions de réalisation |
| **Art. 2** | « clés en main », « interlocuteur principal pour le raccordement », « fournissons et facturons … raccordement, mise en service », « bureau d'étude et de pilotage » | Vendeur matériel + accompagnateur ; coordination ≠ MOE/BE/contrôle/direction travaux ; pose & raccordement exéc. & MES = installateur (contrat séparé) |
| **Art. 3** | process « raccordement » facturé SolarGlobe | 5 étapes ; signature = section A ; devis installateur distinct obligatoire avant pose ; pose section B indicative |
| **Art. 4** | prix incluant « raccordements » | Prix SolarGlobe = section A uniquement ; section B indicative hors prix ; section C indicatif |
| **Art. 5** | échéancier sur « coût global » ; raccordement facturé | Échéancier sur section A uniquement ; pose réglée directement à l'installateur ; SolarGlobe n'encaisse pas la pose |
| **Art. 8** | « contrôle de cohérence », « raccordement/MES réalisés ou coordonnés par SolarGlobe » | SolarGlobe ne réalise/sous-traite/facture/dirige/réceptionne pas la pose ; installateur seul responsable + garanties ; réception Client–installateur |
| **Art. 9** | « suivi technique » large | Périmètre SolarGlobe (matériel/doc) vs installateur (pose/raccordement/MES/décennale) ; désordres pose → installateur |
| **Art. 11** | « seule cause d'annulation » ; acompte « intégralement acquis » automatique | Facturation des prestations réellement réalisées et justifiées ; pas d'acquisition forfaitaire automatique ; droits du Client préservés |
| **Art. 12** | « 14 j à compter de la signature » ; « renonciation expresse » globale | Rétractation prudente : biens (réception) vs services (conclusion) ; exécution anticipée sur demande expresse ; pas de paiement avant 7 j hors étab. **(à valider avocat)** |
| **Art. 13** | bref | Développé : conformité, vices cachés, garanties commerciales, recours, répartition SolarGlobe/installateur |
| **Art. 14** | RGPD minimal | Notice RGPD complète (données, finalités, bases, durées, destinataires, droits, contact) |
| **Art. 16** | périmètre « raccordement et suivi » | Resserré au périmètre réel ; non responsable pose/raccordement exéc./MES/perf ; sans exclusion abusive |
| **Art. 19** | « raccordement » listé en sous-traitance | Pose = contrat séparé Client–installateur, jamais sous-traitance SolarGlobe |
| **Art. 20** | lien ODR (fermé) ; CM2C | ODR supprimé ; médiateur à confirmer selon adhésion réelle |
| **Orthographe** | « un de nos partenaire » | « un de nos partenaires » (à corriger là où la formule apparaît, cf. Partie 4) |

---

## PARTIE 4 — Points nécessitant validation externe

**Avocat (droit conso / construction) :**
- Article 12 (rétractation, contrat mixte biens + services) — rédaction à valider et adapter au mode de vente réel (hors établissement, à distance, en magasin).
- Article 11 (annulation/indemnisation) — vérifier l'absence de clause abusive.
- Article 16 (limitation de responsabilité) — vérifier l'équilibre.
- Vérifier la qualification exacte de SolarGlobe (vendeur/intermédiaire) au regard du droit de la construction (éviter requalification en constructeur/MOE).

**Assureur (RC pro) :** confirmer que le périmètre déclaré (vente + accompagnement, sans pose/MOE) correspond à la police, et que la coordination documentaire n'emporte pas de garantie travaux.

**Comptable / fiscaliste :** **TVA** — le devis utilise 20 %. Vérifier l'éligibilité éventuelle au **taux réduit** applicable à certaines installations PV ≤ 9 kWc sous conditions (cadre fiscal en évolution). **Ne pas modifier le taux sans validation.** *(TODO interne, aucune modification de taux effectuée.)*

**Médiation :** confirmer l'adhésion effective et à jour à **CM2C** (sinon mentionner le médiateur réellement souscrit). Vérifier qu'aucune autre mention réglementaire n'est périmée.

**Orthographe / occurrences :** rechercher « un de nos partenaire » dans tous les supports (devis, e-mails types, site) et corriger en « partenaires ». *(La formule n'apparaît pas dans les CGV v3 ; elle est probablement dans un autre support commercial.)*

---

## PARTIE 5 — Fichier code modifié + mise en œuvre

**Code (contenu PDF uniquement, aucune logique/calcul touché) :**
- `frontend/src/modules/quotes/QuoteDocumentView.tsx` — ajout de la **mention prioritaire** au-dessus du bloc « Bon pour accord / signatures » (affichée quand le devis comporte une ligne pose / section B).

**Contenu à mettre à jour hors code (par l'admin SolarGlobe) :**
1. **Bloc conformité** : coller le texte de la Partie 1.2 dans Organisation → Catalogue devis → Document PDF (texte réglementaire).
2. **CGV** : faire valider la Partie 2 par un avocat, convertir en PDF, puis ré-uploader dans les paramètres CGV de l'organisation (remplace `CGV-SolarGlobe-2026-06-10-v3.pdf`).
3. **Date** : mettre à jour « Dernière mise à jour » des CGV.

**Test / rendu :** le rendu PDF (Playwright) et la vérification visuelle des sections A/B/C + de la nouvelle mention ne sont pas exécutables dans l'environnement de développement actuel (pas de moteur de rendu PDF / pas de base) ; à valider en recette sur l'environnement réel après déploiement, en générant un devis test avec une ligne pose installateur RGE.
