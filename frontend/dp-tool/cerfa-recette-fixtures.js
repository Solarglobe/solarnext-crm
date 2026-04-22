/**
 * Fixtures recette CERFA — rejouer des scénarios sans tout resaisir.
 *
 * Chargement : après dp-app.js (et idéalement sur une page où initCERFA a tourné), ex. :
 *   <script src="cerfa-recette-fixtures.js"></script>
 * Console :
 *   __solarnextCerfaRecetteFixtures.scenario1_client_standard()
 * Puis : générer la description, créer le PDF.
 *
 * Ne pas laisser ce script en production si vous exposez le DP en public sans garde-fou.
 */
(function (w) {
  "use strict";

  function baseCtx(over) {
    return Object.assign(
      {
        nom: "Jean Dupont",
        adresse: "12 bis Rue de la Paix",
        cp: "44000",
        ville: "Nantes"
      },
      over || {}
    );
  }

  function baseClient(over) {
    return Object.assign(
      {
        telephone: "0612345678",
        email: "jean.dupont@exemple.fr"
      },
      over || {}
    );
  }

  function baseCerfa(over) {
    return Object.assign(
      {
        panelCount: 10,
        panelPower: 400,
        panelWidth: 1722,
        panelHeight: 1134,
        panelDepth: 35,
        columnsCount: 2,
        panelsPerRow: 5,
        rowsCount: "",
        panelOrientation: "Portrait",
        roofOrientation: "Sud",
        brand: "ExemplePV",
        color: "Noir",
        energyManagement: "Autoconsommation",
        constructionType: "existing",
        occupationMode: "personnel",
        residenceType: "principale",
        declarantAcceptEmailContact: false,
        urbanismeCU: null,
        urbanismeLot: null,
        urbanismeZAC: null,
        urbanismeAFU: null,
        urbanismePUP: null,
        installationOnRoof: null
      },
      over || {}
    );
  }

  function baseParcel(over) {
    return Object.assign(
      {
        section: "AB",
        numero: "0123",
        surface_m2: 520
      },
      over || {}
    );
  }

  const api = {
    /** Réinitialise partiellement l’état CERFA (champs recette courants). */
    resetCerfaUiFields() {
      var S = w.CERFA_STATE || {};
      [
        "panelCount",
        "panelPower",
        "panelHeight",
        "panelWidth",
        "panelDepth",
        "brand",
        "color",
        "panelsPerRow",
        "columnsCount",
        "rowsCount",
        "panelOrientation",
        "roofOrientation",
        "energyManagement"
      ].forEach(function (k) {
        if (k === "roofOrientation" || k === "energyManagement" || k === "panelOrientation") {
          S[k] = "";
        } else {
          S[k] = "";
        }
      });
      S.constructionType = "";
      S.occupationMode = "";
      S.residenceType = "";
      S.declarantAcceptEmailContact = false;
    },

    scenario1_client_standard() {
      w.DP1_CONTEXT = Object.assign({}, w.DP1_CONTEXT || {}, baseCtx({}));
      w.SMARTPITCH_CTX = w.SMARTPITCH_CTX || {};
      w.SMARTPITCH_CTX.client = Object.assign({}, w.SMARTPITCH_CTX.client || {}, baseClient({}));
      w.DP1_STATE = w.DP1_STATE || {};
      w.DP1_STATE.selectedParcel = baseParcel({});
      w.DP1_STATE.isValidated = true;
      Object.assign(w.CERFA_STATE || {}, baseCerfa({}));
      console.info("[CERFA recette] scenario1_client_standard appliqué");
    },

    scenario2_adresse_complexe() {
      api.scenario1_client_standard();
      w.DP1_CONTEXT = Object.assign({}, w.DP1_CONTEXT || {}, baseCtx({
        adresse: "Hameau des Lilas, lieu-dit La Croix — accès par chemin rural",
        cp: "22140",
        ville: "Bégard"
      }));
      console.info("[CERFA recette] scenario2_adresse_complexe");
    },

    scenario3_telephone_absent() {
      api.scenario1_client_standard();
      w.SMARTPITCH_CTX.client = Object.assign({}, w.SMARTPITCH_CTX.client || {}, { telephone: "" });
      delete w.DP1_CONTEXT.telephone;
      console.info("[CERFA recette] scenario3_telephone_absent");
    },

    scenario4_parcelle_absente() {
      api.scenario1_client_standard();
      w.DP1_STATE.selectedParcel = null;
      w.DP1_STATE.isValidated = false;
      console.info("[CERFA recette] scenario4_parcelle_absente");
    },

    scenario5_puissance_absente() {
      api.scenario1_client_standard();
      w.CERFA_STATE.panelCount = "";
      w.CERFA_STATE.panelPower = "";
      console.info("[CERFA recette] scenario5_puissance_absente — export doit être BLOQUÉ");
    },

    scenario6_construction_neuve() {
      api.scenario1_client_standard();
      w.CERFA_STATE.constructionType = "new";
      console.info("[CERFA recette] scenario6_construction_neuve");
    },

    scenario7_construction_existante() {
      api.scenario1_client_standard();
      w.CERFA_STATE.constructionType = "existing";
      console.info("[CERFA recette] scenario7_construction_existante");
    },

    scenario8a_occupation_personnel() {
      api.scenario1_client_standard();
      w.CERFA_STATE.occupationMode = "personnel";
      console.info("[CERFA recette] scenario8a_occupation_personnel");
    },

    scenario8b_occupation_vente() {
      api.scenario1_client_standard();
      w.CERFA_STATE.occupationMode = "vente";
      console.info("[CERFA recette] scenario8b_occupation_vente");
    },

    scenario8c_occupation_location() {
      api.scenario1_client_standard();
      w.CERFA_STATE.occupationMode = "location";
      console.info("[CERFA recette] scenario8c_occupation_location");
    },

    scenario9a_residence_principale() {
      api.scenario1_client_standard();
      w.CERFA_STATE.residenceType = "principale";
      console.info("[CERFA recette] scenario9a_residence_principale");
    },

    scenario9b_residence_secondaire() {
      api.scenario1_client_standard();
      w.CERFA_STATE.residenceType = "secondaire";
      console.info("[CERFA recette] scenario9b_residence_secondaire");
    },

    /** Pour scénario 10 debug : à activer avant « Créer le CERFA ». */
    enableDebugMode() {
      try {
        w.localStorage.setItem("SOLARNEXT_CERFA_DEBUG", "1");
      } catch (e) {}
      console.info("[CERFA recette] SOLARNEXT_CERFA_DEBUG=1 — recharger la page pour URL sans param si besoin");
    },

    disableDebugMode() {
      try {
        w.localStorage.removeItem("SOLARNEXT_CERFA_DEBUG");
      } catch (e) {}
      console.info("[CERFA recette] debug désactivé");
    }
  };

  w.__solarnextCerfaRecetteFixtures = api;
})(typeof window !== "undefined" ? window : globalThis);
