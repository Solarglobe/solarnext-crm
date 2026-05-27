/**
 * Point d'entree debug - visualisation SolarScene3D (dev uniquement recommande).
 * Route : /dev/solar-scene-3d
 */

import { useEffect, useState } from "react";
import { SolarScene3DViewer } from "../../modules/calpinage/canonical3d/viewer/SolarScene3DViewer";
import { buildDemoSolarScene3D } from "../../modules/calpinage/canonical3d/viewer/demoSolarScene3d";
import type { SolarScene3D } from "../../modules/calpinage/canonical3d/types/solarScene3d";

function DebugToggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: "var(--primary, #7C3AED)" }} />
      {label}
    </label>
  );
}

export default function SolarScene3DDebugPage() {
  const [scene, setScene] = useState<SolarScene3D | null>(null);
  useEffect(() => {
    buildDemoSolarScene3D().then(setScene);
  }, []);
  const [showRoof, setShowRoof] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showObs, setShowObs] = useState(true);
  const [showExt, setShowExt] = useState(true);
  const [showPanels, setShowPanels] = useState(true);
  const [showShading, setShowShading] = useState(true);
  const [showSun, setShowSun] = useState(true);

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>SolarScene3D — moteur canonique (debug)</h2>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
        Scene demo = même géométrie que les tests hardening (zénith + obstacle).
        Couleur panneaux = fraction ombrée (nearShadingSnapshot).
        Aucun recalcul métier dans le viewer.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <DebugToggle checked={showRoof} onChange={setShowRoof} label="Pans" />
        <DebugToggle checked={showEdges} onChange={setShowEdges} label="Arêtes" />
        <DebugToggle checked={showObs} onChange={setShowObs} label="Obstacles" />
        <DebugToggle checked={showExt} onChange={setShowExt} label="Extensions" />
        <DebugToggle checked={showPanels} onChange={setShowPanels} label="Panneaux" />
        <DebugToggle checked={showShading} onChange={setShowShading} label="Couleur ombrage" />
        <DebugToggle checked={showSun} onChange={setShowSun} label="Soleil" />
      </div>
      {!scene ? (
        <div style={{ height: 520, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
          Chargement de la scène demo…
        </div>
      ) : (
        <SolarScene3DViewer
          scene={scene}
          height={520}
          showRoof={showRoof}
          showRoofEdges={showEdges}
          showObstacles={showObs}
          showExtensions={showExt}
          showPanels={showPanels}
          showPanelShading={showShading}
          showSun={showSun}
        />
      )}
    </div>
  );
}
