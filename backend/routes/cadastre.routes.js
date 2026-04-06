import express from "express";
import fetch from "node-fetch";
import logger from "../app/core/logger.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = express.Router();

// GET /api/cadastre/by-point?lat=…&lon=… — JWT requis (isolation org)
router.get("/by-point", verifyJWT, async (req, res) => {
  const { lat, lon } = req.query;

  const numLat = Number(lat);
  const numLon = Number(lon);

  if (!Number.isFinite(numLat) || !Number.isFinite(numLon)) {
    return res.status(400).json({ error: "lat and lon required (numeric)" });
  }

  // API Carto IGN attend WGS84 en (lon, lat)
  const geomObj = { type: "Point", coordinates: [numLon, numLat] };
  const geom = encodeURIComponent(JSON.stringify(geomObj));

  const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${geom}`;

  try {
    const apiRes = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    const text = await apiRes.text(); // on lit en texte d'abord pour diagnostiquer proprement

    if (!apiRes.ok) {
      logger.error("CADASTRE_APICARTO_HTTP", { status: apiRes.status, text: text.slice(0, 500) });
      return res.status(500).json({ error: "Cadastre error" });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      logger.error("CADASTRE_APICARTO_JSON_PARSE", { text: text.slice(0, 500), error: e });
      return res.status(500).json({ error: "Cadastre error" });
    }

    const features = Array.isArray(data?.features) ? data.features : [];

    // Ne plus utiliser data.features[0] : l’API peut renvoyer plusieurs features
    // et feature.geometry peut être null sur le premier. On prend le premier
    // feature dont la géométrie est valide (Polygon ou MultiPolygon).
    const validGeometryTypes = ["Polygon", "MultiPolygon"];
    let feature = null;
    for (const f of features) {
      if (f?.geometry && validGeometryTypes.includes(f.geometry.type)) {
        feature = f;
        break;
      }
    }

    if (!feature) {
      if (features.length === 0) {
        return res.status(404).json({ error: "No parcel found" });
      }
      // Des features existent mais aucune n’a de géométrie valide → erreur explicite
      return res.status(404).json({
        error: "No parcel geometry available (API returned no valid Polygon/MultiPolygon)"
      });
    }

    const props = feature.properties;
    if (!props) {
      return res.status(404).json({ error: "No parcel found" });
    }

    // mapping robuste (selon variations possibles des attributs)
    const section = props.section ?? props.SECTION ?? "";
    const numero = props.numero ?? props.NUMERO ?? props.parcelle ?? props.PARCELLE ?? "";
    const commune = props.commune ?? props.COMMUNE ?? props.nom_com ?? null;
    const surface =
      props.contenance ?? props.surface ?? props.SURFACE ?? props.supf ?? props.SUPF ?? null;

    if (!section || !numero) {
      return res.status(404).json({ error: "No parcel found" });
    }

    // Géométrie parcelle (GeoJSON WGS84) — toujours valide ici (Polygon ou MultiPolygon)
    const geometry = feature.geometry;

    return res.json({
      section,
      numero: String(numero),
      parcelle: String(numero),
      commune: commune != null ? String(commune) : undefined,
      surface_m2: surface != null ? Number(surface) : null,
      geometry
    });

  } catch (err) {
    logger.error("CADASTRE_APICARTO_EXCEPTION", { error: err });
    return res.status(500).json({ error: "Cadastre error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/cadastre/vector?bbox=minLon,minLat,maxLon,maxLat (EPSG:4326)
// DP2 plan de masse : parcelles + bâti vectoriel (PCI vecteur).
// TODO: Remplacer par chargement PCI vecteur réel (GeoJSON/Shapefile préchargés
// ou source équivalente) ; filtrer par bbox côté données.
// ---------------------------------------------------------------------------
router.get("/vector", (req, res) => {
  const bboxStr = req.query.bbox;
  if (!bboxStr || typeof bboxStr !== "string") {
    return res.status(400).json({ error: "bbox required (minLon,minLat,maxLon,maxLat)" });
  }
  const parts = bboxStr.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return res.status(400).json({ error: "bbox must be minLon,minLat,maxLon,maxLat (4 numbers)" });
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon >= maxLon || minLat >= maxLat) {
    return res.status(400).json({ error: "bbox: min < max required" });
  }

  // MOCK : aucune source PCI intégrée → GeoJSON minimal pour ne pas casser le front.
  // À remplacer par lecture fichiers PCI (parcelles + bâtiments) + filtre bbox.
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const delta = Math.min(maxLon - minLon, maxLat - minLat) * 0.1 || 0.0001;
  const features = [
    {
      type: "Feature",
      properties: { kind: "parcel" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [centerLon - delta, centerLat - delta],
          [centerLon + delta, centerLat - delta],
          [centerLon + delta, centerLat + delta],
          [centerLon - delta, centerLat + delta],
          [centerLon - delta, centerLat - delta]
        ]]
      }
    },
    {
      type: "Feature",
      properties: { kind: "building" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [centerLon - delta * 0.5, centerLat - delta * 0.5],
          [centerLon + delta * 0.5, centerLat - delta * 0.5],
          [centerLon + delta * 0.5, centerLat + delta * 0.5],
          [centerLon - delta * 0.5, centerLat + delta * 0.5],
          [centerLon - delta * 0.5, centerLat - delta * 0.5]
        ]]
      }
    }
  ];

  return res.json({
    type: "FeatureCollection",
    features
  });
});

export default router;
