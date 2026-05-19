import { useMemo, useState } from "react";
import "./report-crm-page.css";

type AuditSeverity = "Critique" | "Important" | "Produit" | "Design" | "Dette";

type AuditFinding = {
  severity: AuditSeverity;
  title: string;
  area: string;
  evidence: string;
  impact: string;
  recommendation: string;
};

type RemediationStep = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

type RemediationPhase = {
  id: string;
  title: string;
  goal: string;
  steps: RemediationStep[];
};

const STORAGE_KEY = "solarnext_crm_report_progress_v1";

const findings: AuditFinding[] = [
  {
    severity: "Critique",
    title: "L'onboarding peut etre contourne apres la creation du compte",
    area: "Authentification / premier demarrage",
    evidence:
      "Login.tsx et MfaVerify.tsx redirigent vers /onboarding si onboardingCompleted=false, mais ProtectedRoute ne verifie que l'authentification. Les routes CRM sous / restent accessibles directement.",
    impact:
      "Un nouvel utilisateur peut ouvrir /dashboard et utiliser un CRM partiellement configure, sans profil entreprise complet, sans messagerie validee et sans premier dossier propre.",
    recommendation:
      "Ajouter un garde applicatif qui appelle /auth/me ou expose l'etat utilisateur en contexte, puis redirige toute route CRM vers /onboarding tant que l'onboarding n'est pas termine."
  },
  {
    severity: "Critique",
    title: "L'etape pipeline de l'onboarding est trompeuse",
    area: "Onboarding / pipeline commercial",
    evidence:
      "OnboardingStepPipeline modifie une liste locale, puis PATCH /api/organizations/onboarding stocke uniquement settings_json.onboarding.pipeline. Aucune synchronisation avec pipeline_stages n'est effectuee.",
    impact:
      "L'utilisateur croit personnaliser son Kanban, mais les vraies colonnes backend restent celles de la base. C'est exactement l'incoherence produit la plus risquee dans le premier demarrage.",
    recommendation:
      "Retirer cette etape du premier demarrage ou construire une vraie API transactionnelle de configuration des pipeline_stages avec migration des leads et permissions explicites."
  },
  {
    severity: "Critique",
    title: "Les nouvelles organisations peuvent recevoir un pipeline obsolete",
    area: "Backend / pipeline_stages",
    evidence:
      "Le trigger de seed historique du pipeline et la migration V2 divergent. Le detail lead convertit en client seulement si stageCode === SIGNED.",
    impact:
      "Une organisation creee aujourd'hui peut obtenir une colonne Signe avec code NULL. Deplacer un lead dans cette colonne peut ne pas declencher la conversion client.",
    recommendation:
      "Mettre a jour le trigger de seed avec les codes V2 stables, puis ajouter une migration de reparation pour les organisations existantes avec stages sans code."
  },
  {
    severity: "Critique",
    title: "Les etapes d'onboarding peuvent etre sautees",
    area: "Onboarding / validation",
    evidence:
      "Les boutons de la sidebar onboarding permettent de sauter directement a n'importe quelle etape, et finish() valide seulement l'etape active avant de marquer completed=true.",
    impact:
      "Un compte peut terminer l'onboarding en creant seulement un lead, sans avoir complete les informations obligatoires des autres etapes.",
    recommendation:
      "Verrouiller les etapes futures, calculer une validation globale avant completion, et rendre les boutons de navigation compatibles avec l'etat de progression."
  },
  {
    severity: "Important",
    title: "Le PATCH onboarding n'a pas de garde RBAC admin",
    area: "Backend / permissions",
    evidence:
      "GET/PATCH /api/organizations/onboarding utilisent verifyJWT seulement, alors que /api/organizations/settings et /security demandent org.settings.manage.",
    impact:
      "Tout utilisateur authentifie de l'organisation peut modifier l'etat onboarding et potentiellement marquer le setup complet.",
    recommendation:
      "Limiter PATCH onboarding aux admins ou au createur initial pendant la fenetre de premier demarrage, avec audit log explicite."
  },
  {
    severity: "Important",
    title: "La messagerie de l'onboarding n'est pas reellement testee",
    area: "Onboarding / mail",
    evidence:
      "testMailConnection() utilise un setTimeout local et force mail.tested=true, sans appel IMAP/SMTP ni persistance de compte mail utilisable.",
    impact:
      "L'utilisateur voit une confirmation rassurante alors que le CRM n'a pas valide la capacite d'envoyer ou recevoir des emails.",
    recommendation:
      "Brancher cette etape sur les APIs mail accounts existantes, avec test backend, erreurs lisibles et option de passer l'etape sans fausse validation."
  },
  {
    severity: "Important",
    title: "Les collaborateurs saisis pendant l'onboarding ne sont pas invites",
    area: "Onboarding / equipe",
    evidence:
      "Les collaborateurs sont nettoyes puis stockes dans settings_json.onboarding.collaborators. Aucun utilisateur, invitation ou role RBAC n'est cree.",
    impact:
      "Le setup donne l'impression que l'equipe est configuree, puis l'administrateur doit recommencer ailleurs.",
    recommendation:
      "Remplacer l'etape par un vrai flux d'invitations ou la renommer clairement en brouillon d'equipe a finaliser."
  },
  {
    severity: "Important",
    title: "Le profil entreprise onboarding ne met pas a jour la fiche entreprise canonique",
    area: "Organisation / donnees",
    evidence:
      "Le PATCH onboarding stocke profile dans settings_json.onboarding, tandis que les pages Entreprise utilisent les routes de configuration organisation et documents.",
    impact:
      "L'utilisateur renseigne SIRET, RGE, adresse et couleur, mais ces informations peuvent ne pas alimenter les devis, PDF, factures ou parametres officiels.",
    recommendation:
      "Mapper explicitement les champs onboarding vers les colonnes et settings canoniques utilises par les documents et la facturation."
  },
  {
    severity: "Important",
    title: "Trois APIs de settings organisation peuvent diverger",
    area: "Backend / organization settings",
    evidence:
      "/api/organization/settings merge arbitrairement settings_json tandis que /api/organizations/settings valide economics, quote et finance et synchronise les sequences.",
    impact:
      "Un ancien endpoint peut contourner la validation et desynchroniser prefixe, numerotation, finance ou parametres documentaires.",
    recommendation:
      "Deprecier ou verrouiller l'ancien endpoint, migrer les appels frontend vers les APIs validees et ajouter des tests de non-contournement."
  },
  {
    severity: "Important",
    title: "Le lien email de confirmation pointe vers un onboarding non traite",
    area: "Auth / email verification",
    evidence:
      "mail.service.js construit /dashboard?onboarding=1, mais DashboardPage ne lit pas ce parametre et ProtectedRoute ne redirige pas selon onboardingCompleted.",
    impact:
      "Apres confirmation email, l'utilisateur arrive sur le dashboard au lieu d'un demarrage guide fiable.",
    recommendation:
      "Faire pointer l'email vers /onboarding ou ajouter une logique dashboard explicite qui transforme onboarding=1 en redirection."
  },
  {
    severity: "Produit",
    title: "Des pages importantes sont invisibles dans la navigation",
    area: "Navigation / administration",
    evidence:
      "/settings/security et /admin/audit-log existent dans le router, mais ne sont pas exposees dans la sidebar. Le menu utilisateur ne propose que la deconnexion.",
    impact:
      "MFA, sessions actives et journal d'audit sont introuvables sans connaitre l'URL.",
    recommendation:
      "Creer un espace Parametres coherent avec Securite, Journal d'audit, Messagerie, Organisation et parametres techniques selon les permissions."
  },
  {
    severity: "Produit",
    title: "La navigation admin est fragmentee",
    area: "Sidebar / architecture informationnelle",
    evidence:
      "Entreprise, Parametres techniques, Mail, Messagerie et routes admin historiques sont repartis dans plusieurs groupes, parfois sans lien direct avec le module metier.",
    impact:
      "L'utilisateur ne sait pas si un reglage se trouve dans Entreprise, Finance, Mail ou Parametres techniques. Cela donne une perception de CRM assemble par couches successives.",
    recommendation:
      "Regrouper les reglages dans une section Parametres avec sous-sections stables, et garder la sidebar principale pour les modules operationnels."
  },
  {
    severity: "Produit",
    title: "Des liens visibles peuvent renvoyer brutalement vers Leads",
    area: "Permissions / experience admin",
    evidence:
      "La sidebar rend des sections admin sans filtrage permissionnel fin. AdminRoute redirige les utilisateurs non autorises vers /leads.",
    impact:
      "Un utilisateur clique un menu, puis se retrouve ailleurs sans explication. La sensation produit est celle d'une page cassee.",
    recommendation:
      "Charger les permissions dans AppLayout et masquer, desactiver ou expliquer les pages non accessibles."
  },
  {
    severity: "Produit",
    title: "Le modele Clients n'est pas clair",
    area: "Clients / leads convertis",
    evidence:
      "/clients affiche une page clients, mais /clients/:id redirige vers /leads/:id. Le fichier ClientsList est un wrapper de compatibilite vers pages/clients/ClientsPage.",
    impact:
      "L'utilisateur pense ouvrir une fiche client, mais le routage l'amene dans une fiche lead. Cela fragilise le vocabulaire commercial du CRM.",
    recommendation:
      "Choisir un modele unique : fiche client dediee, ou langage explicite 'dossiers clients' base sur la fiche lead convertie."
  },
  {
    severity: "Dette",
    title: "Des pages legacy restent routees",
    area: "Routes / dette produit",
    evidence:
      "/admin/smartpitch-settings affiche une page de transition vers les parametres PV. Des wrappers comme ClientsList et MairiesPage maintiennent des doubles entrees.",
    impact:
      "Les developpeurs et les utilisateurs avancés peuvent tomber sur des pages intermediaires ou modifier le mauvais fichier.",
    recommendation:
      "Transformer les pages legacy en redirects, renommer les wrappers en RouteEntry, et documenter la carte officielle des routes CRM."
  },
  {
    severity: "Design",
    title: "La cascade CSS est fragile",
    area: "Design system / CSS",
    evidence:
      "main.tsx importe des fichiers legacy avant tokens/primitives, tandis que solarnext-theme.css et primitives.css contiennent encore de gros blocs et doublons de responsive/sidebar.",
    impact:
      "Un petit changement visuel peut regresser une autre page, car l'ordre d'import et les overrides tardifs decident trop souvent du rendu final.",
    recommendation:
      "Reordonner les couches CSS : tokens, primitives, shell, modules, pages. Supprimer les doublons et isoler les overrides historiques dans des fichiers de migration bornes."
  },
  {
    severity: "Design",
    title: "Les composants partages sont contournes",
    area: "UI primitives",
    evidence:
      "Button, Card, ModalShell et ConfirmModal existent, mais plusieurs modules gardent sg-btn, mail-accts__btn, DeleteConfirmModal ou des boutons CSS specifiques.",
    impact:
      "Les boutons, modales et confirmations changent subtilement selon les modules. La sensation SaaS devient moins constante.",
    recommendation:
      "Migrer les boutons, confirmations et modales vers les primitives communes, et reserver le CSS module aux layouts specifiques."
  },
  {
    severity: "Design",
    title: "Le mobile repose trop sur des tableaux horizontaux",
    area: "Responsive / listes",
    evidence:
      "Les tables CRM imposent souvent des min-width de 920px a 1320px pour leads, devis, catalogue ou builder.",
    impact:
      "Sur mobile et tablette, les parcours centraux ressemblent a des feuilles de calcul a scroller lateralement.",
    recommendation:
      "Garder le scroll horizontal seulement pour les editions denses, et creer des vues cards/lignes adaptatives pour listes, dashboards et catalogues."
  },
  {
    severity: "Design",
    title: "Les etats loading, empty et error ne sont pas uniformes",
    area: "Etats produit",
    evidence:
      "Dashboard et Documents ont des etats travailles, alors que QuoteBuilder et InvoiceBuilder affichent encore des surfaces texte plus brutes.",
    impact:
      "Les flux a forte valeur percue paraissent moins finis des que le reseau est lent ou qu'une erreur survient.",
    recommendation:
      "Introduire un composant PageState commun pour loading, empty, error, retry et warning, puis migrer les builders finance."
  },
  {
    severity: "Design",
    title: "Des alertes navigateur cassent l'experience premium",
    area: "Feedback utilisateur",
    evidence:
      "QuoteBuilderPage et InvoiceBuilderPage utilisent encore window.alert pour des retours utilisateur.",
    impact:
      "Les alertes natives bloquent le flux et sortent visuellement du produit.",
    recommendation:
      "Remplacer les alertes par des toasts CRM, callouts inline ou ConfirmModal selon le niveau de decision."
  },
  {
    severity: "Design",
    title: "Le CRM melange plusieurs systemes visuels",
    area: "Design system / coherence SaaS",
    evidence:
      "Les pages combinent qb-page, fin-pole-shell, sn-saas-page, CSS page-specifique et styles inline. L'onboarding utilise des couleurs brutes hors tokens.",
    impact:
      "L'interface fonctionne, mais elle parait moins premium car les espacements, surfaces, boutons et etats ne suivent pas tous la meme grammaire.",
    recommendation:
      "Stabiliser un design system CRM unique : tokens, shell, page header, tabs, cards, tables, empty states, loading states et formulaires."
  },
  {
    severity: "Design",
    title: "La sidebar ne raconte pas encore un produit SaaS mature",
    area: "Navigation / perception",
    evidence:
      "La sidebar contient beaucoup de sections collapsibles de meme poids, avec Mail et Messagerie separes, Installation proche du CRM, puis Parametres techniques.",
    impact:
      "Le produit semble dense et un peu administratif au lieu de guider naturellement : vendre, produire, facturer, piloter, parametrer.",
    recommendation:
      "Recomposer la sidebar autour de 5 poles : Pilotage, Commercial, Production, Finance, Parametres."
  },
  {
    severity: "Design",
    title: "Plusieurs libelles et textes montrent une finition incomplete",
    area: "Microcopy / encodage",
    evidence:
      "Plusieurs fichiers affichent des chaines sans accents ou potentiellement mojibakees selon l'encodage lu, par exemple Securite, Desactiver, roles, modeles.",
    impact:
      "Des details de langue visibles suffisent a faire baisser la confiance dans un outil B2B.",
    recommendation:
      "Faire une passe microcopy UTF-8 complete, normaliser les accents francais et ajouter un controle CI contre les sequences de mojibake."
  }
];

const phases: RemediationPhase[] = [
  {
    id: "phase-1",
    title: "Phase 1 - Premier demarrage fiable",
    goal: "Fermer toutes les failles de l'onboarding avant d'ameliorer le reste du produit.",
    steps: [
      {
        id: "guard-onboarding",
        title: "Ajouter un garde global onboarding",
        description:
          "Toute route CRM doit renvoyer vers /onboarding tant que l'organisation n'a pas termine son demarrage guide.",
        prompt:
          "Dans le repo SolarNext CRM, audite puis modifie le front pour empecher l'acces au CRM tant que onboardingCompleted=false. Exclure calpinage et DP. Implementer un garde dedie autour des routes protegees qui charge /auth/me via getCurrentUser, garde /onboarding accessible, preserve /login, /signup, /mfa-verify, /client-portal et les routes PDF necessaires, affiche un etat de chargement propre, evite les boucles de redirection et ajoute des tests ciblés. Verifier Login, MfaVerify et ProtectedRoute. A la fin, decrire les routes autorisees et les cas testes."
      },
      {
        id: "remove-fake-pipeline",
        title: "Retirer ou rendre vraie l'etape pipeline",
        description:
          "Le pipeline de l'onboarding ne doit plus promettre une personnalisation qui n'est pas appliquee.",
        prompt:
          "Dans SolarNext CRM, corrige l'incoherence de l'etape Pipeline Kanban de l'onboarding. Commence par verifier le modele backend pipeline_stages et le stockage settings_json.onboarding.pipeline. Choisir l'option la plus sure : soit supprimer l'etape du premier demarrage et ajuster STEPS, validation, progress, migration des completedSteps et textes; soit creer une vraie API transactionnelle qui applique les colonnes dans pipeline_stages avec permissions, ordre, is_closed, migration des leads et tests backend. Ne touche pas au calpinage ni a la DP. Le resultat ne doit plus laisser croire a l'utilisateur qu'une action locale modifie le pipeline reel."
      },
      {
        id: "repair-pipeline-seed",
        title: "Reparer le seed pipeline des nouvelles organisations",
        description:
          "Les futures inscriptions doivent recevoir le pipeline V2 avec codes stables, sinon la conversion client peut casser.",
        prompt:
          "Audite les migrations et triggers backend qui creent les pipeline_stages pour une nouvelle organization. Corrige sg_seed_default_pipeline_for_org pour inserer les stages V2 avec codes stables, positions, is_closed et semantiques SIGNED/LOST. Ajouter une migration de reparation pour les organisations existantes dont les stages ont code NULL ou des codes obsoletes, sans casser les leads existants. Ajouter tests backend qui creent une organisation, verifient les stages, puis deplacent un lead vers SIGNED et confirment la conversion client attendue."
      },
      {
        id: "validate-all-onboarding",
        title: "Verrouiller la progression onboarding",
        description:
          "Les etapes futures doivent etre bloquees et la finalisation doit valider tout le parcours.",
        prompt:
          "Corrige la navigation de frontend/src/pages/Onboarding.tsx. Les boutons d'etape ne doivent permettre que les etapes deja terminees, l'etape active et la prochaine etape autorisee. finish() doit valider toutes les sections obligatoires avant de PATCH completed=true. Ajouter des messages d'erreur par section, conserver les brouillons locaux, et tester les cas saut direct vers Premier lead, retour arriere, reload, et completion normale."
      },
      {
        id: "real-mail-team-company",
        title: "Brancher mail, equipe et entreprise sur les donnees reelles",
        description:
          "Le setup doit creer des effets backend concrets ou annoncer clairement qu'il s'agit d'un brouillon.",
        prompt:
          "Remplace les validations fictives de l'onboarding par des operations reelles ou une UX honnete. Le test mail doit appeler une API backend existante ou nouvelle qui valide la configuration IMAP/SMTP sans stocker de secrets en clair. Les collaborateurs doivent declencher des invitations ou etre renommes en brouillon avec CTA vers Utilisateurs. Les champs entreprise doivent alimenter les champs canoniques utilises par devis, factures et PDF. Ajouter journalisation d'audit, gestion d'erreurs, et tests front/back."
      }
    ]
  },
  {
    id: "phase-2",
    title: "Phase 2 - Navigation SaaS coherente",
    goal: "Faire en sorte que chaque page creee ait une place lisible, unique et permissionnelle.",
    steps: [
      {
        id: "settings-hub",
        title: "Creer un hub Parametres",
        description:
          "Regrouper Securite, Organisation, Messagerie, Catalogue, PV, Audit et pages techniques dans une architecture unique.",
        prompt:
          "Refonds la navigation CRM SolarNext en excluant calpinage/DP. Ajouter une section Parametres ou un hub /settings qui expose selon permissions : Mon compte/Securite, Organisation, Utilisateurs, Messagerie, Catalogue devis, Parametres PV, Journal d'audit, Super admin. Mettre a jour AppLayout, les routes, les redirects legacy et les libelles. Eviter les doublons Mail/Messagerie et fournir une navigation mobile propre. Tester les droits admin, super admin et utilisateur standard."
      },
      {
        id: "permission-aware-nav",
        title: "Rendre la sidebar consciente des permissions",
        description:
          "Un utilisateur ne doit pas voir un lien qui le renvoie silencieusement vers /leads.",
        prompt:
          "Dans AppLayout, charger les permissions utilisateur de maniere robuste et construire les nav items a partir d'une matrice route/permission. Masquer ou afficher verrouille les liens non autorises avec tooltip explicite, sans casser le mode super admin et impersonation. Remplacer les redirects abrupts par des pages 403 utiles quand l'utilisateur tape l'URL directement. Ajouter tests unitaires ou integration pour les profils principaux."
      },
      {
        id: "route-inventory",
        title: "Nettoyer les routes cachees et legacy",
        description:
          "Chaque route doit etre soit visible, soit redirect documente, soit supprimee.",
        prompt:
          "Produis et applique un inventaire des routes frontend CRM dans main.tsx. Pour chaque route non visible dans la navigation, decider : ajouter au hub, rediriger, reserver dev, ou supprimer. Transformer /admin/smartpitch-settings en redirect propre vers /admin/settings/pv. Clarifier ClientsList, MairiesPage wrappers et /clients/:id. Ajouter un commentaire court de route entry uniquement si necessaire et mettre a jour les imports router vers les fichiers canoniques."
      }
    ]
  },
  {
    id: "phase-3",
    title: "Phase 3 - Parcours CRM metier",
    goal: "Aligner les objets Leads, Clients, Devis, Factures, Documents et Mail avec ce que l'utilisateur comprend.",
    steps: [
      {
        id: "clients-model",
        title: "Clarifier le modele Clients",
        description:
          "Resoudre l'ambiguite entre client dedie et lead converti.",
        prompt:
          "Audite et corrige le parcours Clients du CRM. Determiner si Clients doit etre une vraie fiche client ou une vue des leads convertis. Aligner /clients, /clients/:id, liens internes, recherche globale, documents, factures et libelles. Si /clients/:id redirige vers /leads/:id, rendre le vocabulaire explicite partout. Sinon creer un detail client routeable. Ajouter tests de navigation et verifier l'experience utilisateur."
      },
      {
        id: "finance-mail-flow",
        title: "Rendre Finance et Mail decouvrables depuis les objets",
        description:
          "Les actions devis, facture, mail et document doivent etre accessibles depuis les fiches metier sans doublons.",
        prompt:
          "Audite les flux Lead/Client -> Devis -> Facture -> Mail -> Documents. Verifier les CTA, liens retour, etats vides, droits, erreurs et coherence des noms. Repositionner les pages ou boutons qui font doublon. Exclure DP et calpinage. Ajouter une carte de parcours dans le code ou docs si utile, puis corriger les incoherences de navigation et d'etats."
      },
      {
        id: "dashboard-actionability",
        title: "Transformer le dashboard en cockpit actionnable",
        description:
          "Le tableau de bord doit guider vers les prochaines actions, pas seulement afficher des KPI.",
        prompt:
          "Audite DashboardPage et dashboard-page.css. Conserver les KPI utiles, mais ajouter des liens d'action coherents vers leads a relancer, devis a signer, factures en retard, mail a traiter. Verifier responsive, empty states et chargement. Remplacer les couleurs de pipeline codees en dur par des tokens ou couleurs issues des stages. Tester sans donnees, avec donnees partielles et avec beaucoup de stages."
      }
    ]
  },
  {
    id: "phase-4",
    title: "Phase 4 - Niveau visuel SaaS",
    goal: "Unifier la qualite percue : surfaces, typographie, espaces, etats, microcopy.",
    steps: [
      {
        id: "design-system-pass",
        title: "Unifier le design system CRM",
        description:
          "Reduire les styles page-specifiques et stabiliser les composants communs.",
        prompt:
          "Faire une passe design system sur le CRM SolarNext hors calpinage/DP. Identifier les usages de qb-page, fin-pole-shell, sn-saas-page, cards, tables, tabs, boutons, formulaires et styles inline. Definir une seule grammaire de page CRM et migrer les pages prioritaires : Dashboard, Leads, Clients, Finance, Mail, Organisation, Onboarding. Garder des rayons <= 8px, densite SaaS, responsive stable, etats loading/empty/error. Verifier par screenshots desktop/mobile."
      },
      {
        id: "microcopy-encoding",
        title: "Corriger microcopy et encodage",
        description:
          "Les textes francais doivent etre propres, accentues et constants.",
        prompt:
          "Scanner frontend/src et backend pour les sequences de mojibake et les textes francais sans accents visibles dans l'UI : Securite, Desactiver, roles, modeles, etc. Corriger uniquement les chaines utilisateur, pas les identifiants techniques. Ajouter un script CI ou test simple qui detecte les sequences typiques 'Ã', 'Â', 'â€™', '�' dans les fichiers UI. Verifier que l'encodage reste UTF-8."
      },
      {
        id: "visual-audit",
        title: "Faire une verification visuelle multi-pages",
        description:
          "Observer ce que l'utilisateur voit vraiment apres les corrections.",
        prompt:
          "Lancer le CRM localement, se connecter avec un compte de test ou fixture, puis capturer desktop et mobile pour Dashboard, Leads, Clients, Finance, Mail, Organisation, Onboarding, Securite et Rapport CRM. Noter tout chevauchement, texte coupe, etat vide bizarre, bouton introuvable ou couleur incoherente. Corriger les problemes detectes et joindre les captures ou chemins de fichiers generes."
      }
    ]
  },
  {
    id: "phase-5",
    title: "Phase 5 - Qualite, tests et gouvernance",
    goal: "Verrouiller le CRM pour que les regressions de navigation et d'onboarding ne reviennent pas.",
    steps: [
      {
        id: "e2e-critical-paths",
        title: "Ajouter des tests E2E des parcours critiques",
        description:
          "Couvrir creation compte, onboarding, lead, client, devis, facture, mail et parametres.",
        prompt:
          "Ajouter des tests Playwright ciblés pour le CRM hors calpinage/DP : signup/login, redirection onboarding obligatoire, completion onboarding, creation lead, conversion client ou acces client, creation devis, creation facture, navigation mail, acces securite selon permissions. Utiliser fixtures stables, eviter les dependances externes non mockees, et documenter comment lancer uniquement ces tests."
      },
      {
        id: "api-contracts",
        title: "Verifier les contrats frontend/backend",
        description:
          "Chaque page visible doit avoir des APIs coherentes, permissionnees et testees.",
        prompt:
          "Construire une matrice routes frontend -> APIs backend pour le CRM SolarNext hors calpinage/DP. Pour chaque entree, verifier permission, erreurs, donnees vides, org ownership et coherence des noms. Ajouter ou corriger tests backend pour onboarding, organization settings, mail, security, clients/leads, finance. Corriger les endpoints morts ou les front calls qui avalent trop silencieusement les erreurs."
      },
      {
        id: "settings-rbac",
        title: "Verrouiller RBAC et settings organisation",
        description:
          "Les endpoints onboarding et settings ne doivent plus diverger ni contourner les validations.",
        prompt:
          "Audite les routes /api/organizations/onboarding, /api/organizations/settings, /api/organization/settings et les appels frontend associes. Ajouter une protection RBAC coherente pour PATCH onboarding, avec exception documentee si necessaire pour l'admin createur initial. Deprecier ou verrouiller l'ancien endpoint /api/organization/settings qui merge settings_json sans validation, migrer les callers, et ajouter des tests qui prouvent qu'on ne peut plus contourner validation quote/finance/economics ni marquer onboarding complete sans droit."
      },
      {
        id: "release-gate",
        title: "Mettre un gate de release CRM",
        description:
          "Definir les controles a lancer avant chaque livraison CRM.",
        prompt:
          "Creer un gate de release CRM documente et scriptable. Il doit lancer build frontend, tests unitaires CRM, tests backend pertinents, tests E2E critiques, check encodage UI, check routes cachees, et audit rapide accessibilite/navigation. Ajouter une commande npm si possible et documenter les criteres de succes. Exclure explicitement calpinage et DP de ce gate."
      }
    ]
  }
];

const severityClass: Record<AuditSeverity, string> = {
  Critique: "report-crm-badge--critical",
  Important: "report-crm-badge--important",
  Produit: "report-crm-badge--product",
  Design: "report-crm-badge--design",
  Dette: "report-crm-badge--debt"
};

function readProgress(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeProgress(progress: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* ignore */
  }
}

export default function ReportCrmPage() {
  const [view, setView] = useState<"audit" | "plan">("audit");
  const [activePhaseId, setActivePhaseId] = useState(phases[0].id);
  const [progress, setProgress] = useState<Record<string, boolean>>(() => readProgress());

  const allStepIds = useMemo(() => phases.flatMap((phase) => phase.steps.map((step) => step.id)), []);
  const completedCount = allStepIds.filter((id) => progress[id]).length;
  const progressPct = Math.round((completedCount / allStepIds.length) * 100);
  const activePhase = phases.find((phase) => phase.id === activePhaseId) ?? phases[0];

  const setStepDone = (stepId: string, done: boolean) => {
    setProgress((current) => {
      const next = { ...current, [stepId]: done };
      writeProgress(next);
      return next;
    });
  };

  const setPhaseDone = (phase: RemediationPhase, done: boolean) => {
    setProgress((current) => {
      const next = { ...current };
      phase.steps.forEach((step) => {
        next[step.id] = done;
      });
      writeProgress(next);
      return next;
    });
  };

  return (
    <div className="report-crm-page">
      <aside className="report-crm-sidebar" aria-label="Navigation rapport CRM">
        <div className="report-crm-sidebar__brand">
          <span>Rapport CRM</span>
          <strong>{progressPct}%</strong>
        </div>
        <div className="report-crm-progress" aria-label={`Progression globale ${progressPct}%`}>
          <span style={{ width: `${progressPct}%` }} />
        </div>
        <nav className="report-crm-view-tabs" aria-label="Pages du rapport">
          <button type="button" className={view === "audit" ? "is-active" : ""} onClick={() => setView("audit")}>
            Audit complet
          </button>
          <button type="button" className={view === "plan" ? "is-active" : ""} onClick={() => setView("plan")}>
            Plan de correction
          </button>
        </nav>
        <div className="report-crm-phase-nav">
          {phases.map((phase) => {
            const phaseDone = phase.steps.every((step) => progress[step.id]);
            return (
              <button
                type="button"
                key={phase.id}
                className={phase.id === activePhaseId ? "is-active" : ""}
                onClick={() => {
                  setView("plan");
                  setActivePhaseId(phase.id);
                }}
              >
                <span>{phase.title}</span>
                <strong>{phaseDone ? "Terminee" : `${phase.steps.filter((step) => progress[step.id]).length}/${phase.steps.length}`}</strong>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="report-crm-main">
        <header className="report-crm-hero">
          <div>
            <p>Audit CRM SolarNext</p>
            <h1>Rapport CRM</h1>
            <span>
              Perimetre : CRM complet, navigation, onboarding, backend visible, routes, esthetique et coherence SaaS.
              Exclusions volontaires : calpinage, DP et declaration prealable.
            </span>
          </div>
          <div className="report-crm-score">
            <strong>98%</strong>
            <span>Objectif qualite vise</span>
          </div>
        </header>

        {view === "audit" ? (
          <section className="report-crm-section" aria-label="Audit complet">
            <div className="report-crm-summary-grid">
              <article>
                <span>Verdict</span>
                <strong>CRM solide mais encore trop assemble par couches</strong>
                <p>
                  Les modules principaux existent, mais la premiere experience, les reglages et certaines routes cachent
                  des incoherences qui font baisser la perception SaaS.
                </p>
              </article>
              <article>
                <span>Priorite absolue</span>
                <strong>Onboarding</strong>
                <p>
                  Le demarrage guide doit etre fiable avant toute refonte visuelle : aujourd'hui il peut etre saute et
                  promet des actions non appliquees.
                </p>
              </article>
              <article>
                <span>Navigation</span>
                <strong>Unifier les parametres</strong>
                <p>
                  Les pages admin, securite, messagerie, PV et organisation doivent vivre dans une architecture claire et
                  permissionnelle.
                </p>
              </article>
            </div>

            <div className="report-crm-findings">
              {findings.map((finding) => (
                <article className="report-crm-finding" key={finding.title}>
                  <div className="report-crm-finding__head">
                    <span className={`report-crm-badge ${severityClass[finding.severity]}`}>{finding.severity}</span>
                    <span>{finding.area}</span>
                  </div>
                  <h2>{finding.title}</h2>
                  <dl>
                    <div>
                      <dt>Preuve</dt>
                      <dd>{finding.evidence}</dd>
                    </div>
                    <div>
                      <dt>Impact utilisateur</dt>
                      <dd>{finding.impact}</dd>
                    </div>
                    <div>
                      <dt>Correction recommandee</dt>
                      <dd>{finding.recommendation}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="report-crm-section report-crm-plan" aria-label="Plan de correction">
            <div className="report-crm-plan-head">
              <div>
                <p>Progression globale</p>
                <h2>{completedCount} etapes terminees sur {allStepIds.length}</h2>
              </div>
              <button
                type="button"
                className="report-crm-phase-check"
                onClick={() => setPhaseDone(activePhase, !activePhase.steps.every((step) => progress[step.id]))}
              >
                {activePhase.steps.every((step) => progress[step.id]) ? "Marquer la phase ouverte" : "Marquer la phase terminee"}
              </button>
            </div>

            <div className="report-crm-phase">
              <div className="report-crm-phase__intro">
                <span>{activePhase.title}</span>
                <h2>{activePhase.goal}</h2>
              </div>
              <div className="report-crm-step-list">
                {activePhase.steps.map((step) => (
                  <article className={progress[step.id] ? "report-crm-step is-done" : "report-crm-step"} key={step.id}>
                    <label className="report-crm-step__check">
                      <input
                        type="checkbox"
                        checked={Boolean(progress[step.id])}
                        onChange={(event) => setStepDone(step.id, event.target.checked)}
                      />
                      <span>{progress[step.id] ? "Termine" : "A faire"}</span>
                    </label>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <div className="report-crm-prompt">
                      <span>Prompt de correction</span>
                      <p>{step.prompt}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
