/**
 * Point d’entrée debug — visualisation SolarScene3D (dev uniquement recommandé).
 * Route : /dev/solar-scene-3d (basename /crm.html)
 */

import { Box, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { SolarScene3DViewer } from "../../modules/calpinage/canonical3d/viewer/SolarScene3DViewer";
import { buildDemoSolarScene3D } from "../../modules/calpinage/canonical3d/viewer/demoSolarScene3d";

export default function SolarScene3DDebugPage() {
  const scene = useMemo(() => buildDemoSolarScene3D(), []);
  const [showRoof, setShowRoof] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [showObs, setShowObs] = useState(true);
  const [showExt, setShowExt] = useState(true);
  const [showPanels, setShowPanels] = useState(true);
  const [showShading, setShowShading] = useState(true);
  const [showSun, setShowSun] = useState(true);

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h6" gutterBottom>
        SolarScene3D — moteur canonique (debug)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Scène démo = même géométrie que les tests hardening (zénith + obstacle). Couleur panneaux = fraction ombrée
        (nearShadingSnapshot). Aucun recalcul métier dans le viewer.
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
        <FormControlLabel control={<Switch checked={showRoof} onChange={(_, v) => setShowRoof(v)} />} label="Pans" />
        <FormControlLabel control={<Switch checked={showEdges} onChange={(_, v) => setShowEdges(v)} />} label="Arêtes" />
        <FormControlLabel control={<Switch checked={showObs} onChange={(_, v) => setShowObs(v)} />} label="Obstacles" />
        <FormControlLabel control={<Switch checked={showExt} onChange={(_, v) => setShowExt(v)} />} label="Extensions" />
        <FormControlLabel control={<Switch checked={showPanels} onChange={(_, v) => setShowPanels(v)} />} label="Panneaux" />
        <FormControlLabel
          control={<Switch checked={showShading} onChange={(_, v) => setShowShading(v)} />}
          label="Couleur ombrage"
        />
        <FormControlLabel control={<Switch checked={showSun} onChange={(_, v) => setShowSun(v)} />} label="Soleil" />
      </Stack>
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
    </Box>
  );
}
