// ======================================================
// pdf/render/mandat.js — remplissage mandat (SmartPitch)
// ======================================================

(function () {

  if (!window.__MANDAT_DATA__) return;

  // 🔹 SmartPitch injecte TOUT le ctx
  // 🔹 Le mandat ne consomme que ctx.client
  const data = window.__MANDAT_DATA__.client;
  if (!data) return;

  fillMandat(data);

  function fillMandat(client) {
    document.querySelectorAll("[data-field]").forEach(el => {
      const field = el.dataset.field;

      // ex: data-field="client.nom"
      const key = field.startsWith("client.")
        ? field.replace("client.", "")
        : field;

      const value = client[key];

      if (value !== undefined && value !== null && value !== "") {
        el.textContent = formatValue(key, value);
      }
    });
  }

  function formatValue(field, value) {
    if (
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
