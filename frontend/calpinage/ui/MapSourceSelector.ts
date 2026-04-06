/**
 * UI sélecteur de source carte pour le support toiture (étape 5.1).
 * L'utilisateur ne réfléchit qu'au support : source, zoom, orientation, centre, puis capture.
 * Menu déroulant (Google Satellite) + bouton "Capturer la vue". Échelle et Nord automatiques.
 */

export type MapSource = "google-satellite";

export type MapSourceSelectorOptions = {
  container: HTMLElement;
  onCapture: () => void | Promise<void>;
};

/**
 * Crée le bloc UI : sélecteur de source (dropdown) + bouton Capturer la vue.
 * Callback onCapture au clic. Échelle réelle et Nord sont calculés automatiquement à la capture.
 */
export function renderMapSourceSelector(options: MapSourceSelectorOptions): void {
  const { container, onCapture } = options;

  const wrap = document.createElement("div");
  wrap.className = "map-source-selector";

  const label = document.createElement("label");
  label.textContent = "Source carte";
  label.setAttribute("for", "calpinage-map-source");
  wrap.appendChild(label);

  const select = document.createElement("select");
  select.id = "calpinage-map-source";
  select.setAttribute("aria-label", "Source de la carte");
  const opt = document.createElement("option");
  opt.value = "google-satellite";
  opt.textContent = "Google Satellite";
  select.appendChild(opt);
  wrap.appendChild(select);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-capture-roof";
  btn.textContent = "Capturer la vue";
  btn.title = "Cadrez la carte (zoom, orientation, centre), puis capturez. Échelle et Nord automatiques.";
  btn.addEventListener("click", () => {
    const p = onCapture();
    if (p && typeof p.then === "function") {
      p.then(() => {}).catch((err) => console.error("[MapSourceSelector] onCapture", err));
    }
  });
  wrap.appendChild(btn);

  container.appendChild(wrap);
}
