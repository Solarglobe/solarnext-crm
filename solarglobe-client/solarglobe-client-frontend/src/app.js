/* ======================================================
   SolarGlobe Ã¢â‚¬â€ Espace Client
   app.js (FINAL CLEAN UTF-8)
   Correction UNIQUE : ouverture / tÃƒÂ©lÃƒÂ©chargement PDF via /file
====================================================== */

(function () {
  const API_ENDPOINT = "/client";
  let TOKEN = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    TOKEN = new URLSearchParams(window.location.search).get("token");
    if (!TOKEN) return showFatalError("AccÃƒÂ¨s invalide. Token manquant.");

    try {
      const data = await fetchClientData(TOKEN);
      renderAll(data);
    } catch (e) {
      console.error(e);
      showFatalError("Impossible de charger votre dossier.");
    }
  }

  async function fetchClientData(token) {
    const res = await fetch(`${API_ENDPOINT}?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return await res.json();
  }

  function renderAll(data) {
    renderHeader(data);
    renderSummary(data);
    renderPipeline(data);
    renderDocuments(data);
    renderAdvisor(data);
  }

  /* ===============================
     HEADER
  =============================== */

  function renderHeader(data) {
    setTextAttr("data-client-nom", data.client?.nom);
    setTextAttr("data-reference", (data.reference_dossier || "â€”").replace(/^CRM-LEAD-/, "SOLARNEXT-"));


    setTextAttr("data-projet-type", "Projet photovoltaÃ¯que");
    setTextAttr("data-projet-ville", data.adresse?.ville);
    setTextAttr("data-projet-bien", data.adresse?.type_bien);

    setTextAttr(
  "data-statut-badge",
  (() => {
    const s = normalizeText(data.statut);
    if (s.includes("dp") && s.includes("depose"))   return "Statut de votre projet : DÃ©claration prÃ©alable dÃ©posÃ©e";
    if (s.includes("dp") && s.includes("accepte"))  return "Statut de votre projet : DÃ©claration prÃ©alable acceptÃ©e";
    if (s.includes("devis") && s.includes("signe")) return "Statut de votre projet : Devis signÃ©";
    if (s.includes("installation") && s.includes("planifie")) return "Statut de votre projet : Installation planifiÃ©e";
    if (s.includes("installation") && s.includes("realise"))  return "Statut de votre projet : Installation rÃ©alisÃ©e";
    if (s.includes("consuel") && s.includes("obtenu")) return "Statut de votre projet : Consuel obtenu";
    if (s.includes("mise en service")) return "Statut de votre projet : Mise en service";
    return `Statut de votre projet : ${data.statut || "â€”"}`;
  })()
);

  }

  /* ===============================
     SYNTHÃƒË†SE
  =============================== */

  function renderSummary(data) {
    setTextAttr("data-adresse", data.adresse?.adresse);
    setTextAttr("data-code-postal", data.adresse?.code_postal);
    setTextAttr("data-ville", data.adresse?.ville);

    setTextAttr("data-type-bien", data.adresse?.type_bien);
    setTextAttr("data-type-toiture", data.projet?.type_toiture);
    setTextAttr("data-orientation", data.projet?.orientation);
    setTextAttr("data-panneaux", data.projet?.panneaux_max);
    setTextAttr("data-ombrage", data.projet?.ombrage);

    const conso = data.consommation_annuelle_kwh;
    setTextAttr(
      "data-consommation",
      conso != null ? `${formatNumber(conso)} kWh` : ""
    );
  }

  /* ===============================
     PIPELINE
  =============================== */

  function renderPipeline(data) {
    const pipeline = document.querySelector("[data-pipeline]");
    if (!pipeline) return;

    const statusKey = mapStatutToStepKey(data.statut);

    pipeline.querySelectorAll(".pipeline-step").forEach(el => {
      el.classList.remove("done", "active");
    });

    if (statusKey) {
      let reached = false;
      pipeline.querySelectorAll(".pipeline-step").forEach(el => {
        const key = (el.getAttribute("data-step") || "").trim();
        if (reached) return;

        if (key === statusKey) {
          el.classList.add("active");
          reached = true;
        } else {
          el.classList.add("done");
        }
      });
    }

    const ctx = getPipelineTexts(statusKey);
    setTextAttr("data-pipeline-context", ctx.context);
    setTextAttr("data-pipeline-note", ctx.note);
  }

  function getPipelineTexts(statusKey) {
    if (statusKey === "dp_submitted") {
      return {
        context:
          "La dÃ©claration prÃ©alable a Ã©tÃ© dÃ©posÃ©e auprÃ¨s de la mairie compÃ©tente. Les dÃ©lais dâ€™instruction sont propres Ã  lâ€™administration et ne nÃ©cessitent aucune action de votre part.",
        note:
          "Nous suivons le dossier et vous informerons dÃ¨s rÃ©ception de la rÃ©ponse officielle."
      };
    }

    return {
      context:
        "Votre projet suit un dÃ©roulement structurÃ© et maÃ®trisÃ©. Nous pilotons les diffÃ©rentes Ã©tapes et vous informons Ã  chaque jalon important.",
      note:
        "Aucune action particuliÃ¨re nâ€™est requise de votre part Ã  ce stade."
    };
  }

  function mapStatutToStepKey(statut) {
    const s = normalizeText(statut);
    if (!s) return null;

    if (s.includes("devis") && (s.includes("signe") || s.includes("sign"))) return "signed";

    if (s.includes("dp")) {
      if (s.includes("depose")) return "dp_submitted";
      if (s.includes("accepte")) return "dp_accepted";
    }

    if (s.includes("installation")) {
      if (s.includes("planifie")) return "install_planned";
      if (s.includes("realise")) return "install_done";
    }

    if (s.includes("consuel")) {
      if (s.includes("obtenu")) return "consuel_ok";
    }

    if (s.includes("mise en service")) return "commissioning";

    return null;
  }

  function normalizeText(str) {
    if (!str) return "";
    return String(str)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ===============================
     DOCUMENTS
  =============================== */

  function renderDocuments(data) {
    const list = document.querySelector("[data-documents-list]");
    if (!list) return;

    const template = list.querySelector("[data-document]");
    if (!template) return;

    const tpl = template.cloneNode(true);
    list.innerHTML = "";

    const propositions = data.documents?.proposition_commerciale || [];
    const devis = data.documents?.devis || [];
    const docs = [...propositions, ...devis];

    const proposalTitleEl = document.querySelector("[data-proposal-title]");
    if (proposalTitleEl) {
      proposalTitleEl.textContent = propositions[0]?.label || "Proposition personnalisÃƒÂ©e";
    }

    setTextAttr(
      "data-proposal-note",
      "Cette proposition a Ã©tÃ© Ã©tablie sur mesure, Ã  partir des caractÃ©ristiques de votre habitation et de vos usages. Elle constitue la base contractuelle et technique de votre projet."
    );

    docs.forEach(doc => {
      const item = tpl.cloneNode(true);

      const labelEl = item.querySelector("[data-document-label]");
      const fileEl = item.querySelector("[data-document-filename]");
      const openBtn = item.querySelector("[data-action-open]");
      const dlBtn = item.querySelector("[data-action-download]");

      if (labelEl) labelEl.textContent = doc.label || "";
      if (fileEl) fileEl.textContent = doc.file_name || "";

      if (openBtn) {
        openBtn.onclick = () => {
          if (!doc.url || !TOKEN) return;
          window.open(
            `/file?token=${encodeURIComponent(TOKEN)}&path=${encodeURIComponent(doc.url)}`,
            "_blank",
            "noopener"
          );
        };
      }

     if (dlBtn) {
  dlBtn.onclick = () => {
    if (!doc.url || !TOKEN) return;
    window.location.href =
      `/file?token=${encodeURIComponent(TOKEN)}&path=${encodeURIComponent(doc.url)}&download=1`;
  };
}

      item.removeAttribute("data-document");
      list.appendChild(item);
    });
  }

  /* ===============================
     INTERLOCUTEUR
  =============================== */

  function renderAdvisor(data) {
    setTextAttr("data-conseiller-nom", data.conseiller?.nom);
    setTextAttr("data-conseiller-email", data.conseiller?.email);
  }

  /* ===============================
     HELPERS
  =============================== */

  function setTextAttr(attrName, value) {
    const el = document.querySelector(`[${attrName}]`);
    if (!el) return;
    el.textContent = value != null ? String(value) : "";
  }

  function formatNumber(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return String(n ?? "");
    return num.toLocaleString("fr-FR");
  }

  function showFatalError(message) {
    document.body.innerHTML = `
      <div style="padding:80px;text-align:center;color:#fff;background:#0b0e13">
        <h2>AccÃƒÂ¨s indisponible</h2>
        <p>${message}</p>
      </div>
    `;
  }
})();
