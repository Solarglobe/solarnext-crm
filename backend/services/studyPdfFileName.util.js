/**
 * Nom de fichier PDF étude : Client-Etude-Scenario.pdf (Windows / Mac / navigateurs).
 */

export function slugify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

export function mapScenarioName(id) {
  switch (id) {
    case "BASE":
      return "SansBatterie";
    case "BATTERY_PHYSICAL":
      return "BatteriePhysique";
    case "BATTERY_VIRTUAL":
      return "BatterieVirtuelle";
    default:
      return "Scenario";
  }
}

/**
 * @param {string} clientName
 * @param {string} studyName
 * @param {string|null|undefined} selectedScenarioId
 * @returns {string} nom de fichier .pdf
 */
export function buildStudyPdfFileName(clientName, studyName, selectedScenarioId) {
  const a = slugify(clientName) || "Client";
  const b = slugify(studyName) || "Etude";
  const c = mapScenarioName(selectedScenarioId);
  let name = `${a}-${b}-${c}.pdf`;
  if (name.length > 200) {
    name = `${name.slice(0, 196)}.pdf`;
  }
  return name;
}
