/**
 * UI outil Calibration (étape 5.2).
 * Bouton Activer calibration, instruction, champ Distance réelle (m), bouton Valider.
 */

export type CalibrationPanelOptions = {
  container: HTMLElement;
  onActivateCalibration: () => void;
  onValidateCalibration: (meters: number) => void;
};

/**
 * Crée le bloc UI : Activer calibration, instruction, input Distance réelle (m), Valider.
 */
export function renderCalibrationPanel(options: CalibrationPanelOptions): {
  setCalibrationActive: (active: boolean) => void;
  setPointsAB: (has: boolean) => void;
  setError: (msg: string | null) => void;
  getMetersInput: () => number;
  destroy: () => void;
} {
  const { container, onActivateCalibration, onValidateCalibration } = options;

  let active = false;
  let hasAB = false;
  let errorMsg: string | null = null;

  const wrap = document.createElement("div");
  wrap.className = "calibration-panel";

  const btnActivate = document.createElement("button");
  btnActivate.type = "button";
  btnActivate.className = "btn-activate-calibration";
  btnActivate.textContent = "Activer calibration";
  wrap.appendChild(btnActivate);

  const instruction = document.createElement("p");
  instruction.className = "calibration-instruction";
  instruction.textContent = "Cliquez deux points dont vous connaissez la distance réelle.";
  instruction.style.marginTop = "10px";
  instruction.style.marginBottom = "10px";
  instruction.style.fontSize = "13px";
  instruction.style.color = "var(--muted, #6b7280)";
  wrap.appendChild(instruction);

  const labelDist = document.createElement("label");
  labelDist.textContent = "Distance réelle (m)";
  labelDist.setAttribute("for", "calpinage-distance-meters");
  labelDist.style.display = "block";
  labelDist.style.marginBottom = "4px";
  labelDist.style.fontSize = "13px";
  wrap.appendChild(labelDist);

  const inputMeters = document.createElement("input");
  inputMeters.id = "calpinage-distance-meters";
  inputMeters.type = "number";
  inputMeters.step = "0.01";
  inputMeters.min = "0.01";
  inputMeters.placeholder = "ex. 5.00";
  inputMeters.style.width = "100%";
  inputMeters.style.padding = "8px";
  inputMeters.style.marginBottom = "10px";
  wrap.appendChild(inputMeters);

  const errorEl = document.createElement("p");
  errorEl.className = "calibration-error";
  errorEl.style.color = "#b91c1c";
  errorEl.style.fontSize = "12px";
  errorEl.style.marginBottom = "8px";
  errorEl.style.minHeight = "18px";
  wrap.appendChild(errorEl);

  const btnValidate = document.createElement("button");
  btnValidate.type = "button";
  btnValidate.className = "btn-validate-calibration";
  btnValidate.textContent = "Valider la calibration";
  wrap.appendChild(btnValidate);

  function updateUI() {
    instruction.style.display = active ? "block" : "none";
    labelDist.style.display = active ? "block" : "none";
    inputMeters.style.display = active ? "block" : "none";
    btnValidate.style.display = active ? "block" : "none";
    errorEl.textContent = errorMsg || "";
    errorEl.style.display = errorMsg ? "block" : "none";
    btnValidate.disabled = !hasAB || !inputMeters.value || Number(inputMeters.value) <= 0;
  }

  btnActivate.addEventListener("click", () => {
    errorMsg = null;
    updateUI();
    onActivateCalibration();
  });

  btnValidate.addEventListener("click", () => {
    const raw = inputMeters.value.trim();
    const meters = parseFloat(raw);
    if (Number.isNaN(meters) || meters <= 0) {
      setError("Saisissez une distance réelle strictement positive (m).");
      return;
    }
    errorMsg = null;
    updateUI();
    onValidateCalibration(meters);
  });

  inputMeters.addEventListener("input", () => {
    errorMsg = null;
    updateUI();
  });

  function setCalibrationActive(activeVal: boolean) {
    active = activeVal;
    updateUI();
  }

  function setPointsAB(has: boolean) {
    hasAB = has;
    updateUI();
  }

  function setError(msg: string | null) {
    errorMsg = msg;
    updateUI();
  }

  function getMetersInput(): number {
    const v = parseFloat(inputMeters.value);
    return Number.isNaN(v) ? 0 : v;
  }

  updateUI();
  container.appendChild(wrap);

  return {
    setCalibrationActive,
    setPointsAB,
    setError,
    getMetersInput,
    destroy: () => wrap.remove(),
  };
}
