// ======================================================
// pdf/render/mandat.js — remplissage mandat (SmartPitch + signature)
// ======================================================

(function () {
  if (!window.__MANDAT_DATA__) return;

  const root = window.__MANDAT_DATA__;
  const data = root.client;
  if (data) fillMandat(data);

  const sig = root.mandatSignature;
  const ph = document.getElementById("mandat-mandant-sign-placeholder");
  const img = document.getElementById("mandat-mandant-signature-img");
  const nameEl = document.getElementById("mandat-signatory-name");
  const wrap = document.getElementById("mandat-signatory-name-wrap");
  const dateEl = document.getElementById("dateDuJour2");
  const accEl = document.getElementById("mandat-read-acceptance-line");

  function officialSigIso(s) {
    if (!s) return null;
    if (typeof s.signedAtServer === "string" && s.signedAtServer.trim()) return s.signedAtServer.trim();
    if (typeof s.signedAt === "string" && s.signedAt.trim()) return s.signedAt.trim();
    return null;
  }

  function formatSigDateFr(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? String(iso)
      : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  if (sig && sig.signed === true && sig.signatureDataUrl && img) {
    img.src = sig.signatureDataUrl;
    img.style.display = "block";
    if (ph) ph.style.display = "none";
    if (nameEl && sig.name) {
      nameEl.textContent = sig.name;
      if (wrap) wrap.style.display = "block";
    }
    const officialIso = officialSigIso(sig);
    if (dateEl && officialIso) {
      dateEl.textContent = formatSigDateFr(officialIso);
    }
    if (accEl && sig.accepted === true && sig.acceptedLabel) {
      let line = String(sig.acceptedLabel);
      const dt = formatSigDateFr(officialIso);
      if (dt) line = line + " — " + dt;
      accEl.textContent = line;
      accEl.style.display = "block";
    }
  }

  function fillMandat(client) {
    document.querySelectorAll("[data-field]").forEach((el) => {
      const field = el.dataset.field;

      const key = field.startsWith("client.") ? field.replace("client.", "") : field;

      let value = client[key];
      if (key === "date_naissance") {
        value =
          client.date_naissance ??
          client.birthDate ??
          client.birth_date ??
          value;
      }

      if (value !== undefined && value !== null && value !== "") {
        el.textContent = formatValue(key, value);
      }
    });
  }

  function formatValue(field, value) {
    const isDob =
      field === "date_naissance" || field === "birthDate" || field === "birth_date";
    if (isDob && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      const [y, m, d] = value.trim().split("-");
      return `${d}/${m}/${y}`;
    }
    if (
      typeof field === "string" &&
      field.includes("date") &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      const [y, m, d] = value.split("-");
      return `${d}/${m}/${y}`;
    }
    return value;
  }
})();
