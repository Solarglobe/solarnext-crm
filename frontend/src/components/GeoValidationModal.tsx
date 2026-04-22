/**
 * GeoValidationModal — Validation cadastrale obligatoire
 * Modal plein écran avec carte OpenLayers (ortho uniquement, sans couche parcellaire IGN),
 * marker draggable, récupération parcelle cadastrale, validation via POST /api/addresses/verify-pin
 */

import React, { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import MapBrowserEvent from "ol/MapBrowserEvent";
import View from "ol/View";
import { listen, unlistenByKey } from "ol/events";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import WMTS from "ol/source/WMTS";
import WMTSTileGrid from "ol/tilegrid/WMTS";
import { getWidth } from "ol/extent";
import { get as getProjection } from "ol/proj";
import { fromLonLat, toLonLat } from "ol/proj";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { Icon, Style } from "ol/style";
import { fetchCadastreByPoint, verifyPin } from "../services/address.service";
import { parseGeoLatitude, parseGeoLongitude, resolveCoordOrFrance } from "./geoCoordinateParse";

// WMTS IGN — Orthophoto + Parcellaire (Géoplateforme)
function createOrthoLayer(): TileLayer<WMTS> {
  const proj3857 = getProjection("EPSG:3857")!;
  const maxResolution = getWidth(proj3857.getExtent()) / 256;
  const resolutions: number[] = [];
  const matrixIds: string[] = [];
  for (let i = 0; i <= 21; i++) {
    matrixIds.push(String(i));
    resolutions.push(maxResolution / Math.pow(2, i));
  }
  const tileGrid = new WMTSTileGrid({
    origin: [-20037508, 20037508],
    resolutions,
    matrixIds,
  });
  const source = new WMTS({
    url: "https://data.geopf.fr/wmts",
    layer: "ORTHOIMAGERY.ORTHOPHOTOS",
    matrixSet: "PM",
    format: "image/jpeg",
    projection: "EPSG:3857",
    tileGrid,
    style: "normal",
    attributions: "© IGN",
  });
  return new TileLayer({ source });
}

export interface GeoValidationModalProps {
  addressId: string;
  /** Si absent (ex. adresse sans GPS encore), centre France métropolitaine — le point n’est persisté qu’après confirmation. */
  lat?: number | string | null;
  lon?: number | string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function GeoValidationModal({
  addressId,
  lat,
  lon,
  onClose,
  onSuccess,
}: GeoValidationModalProps) {
  const initialLatParsed = parseGeoLatitude(lat);
  const initialLonParsed = parseGeoLongitude(lon);
  const hasNoInitialCoords = initialLatParsed === null && initialLonParsed === null;

  const initial = resolveCoordOrFrance(lat, lon);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const markerSourceRef = useRef<VectorSource | null>(null);
  const [currentLat, setCurrentLat] = useState(initial.lat);
  const [currentLon, setCurrentLon] = useState(initial.lon);
  const [parcelle, setParcelle] = useState<{
    section: string;
    numero: string;
    commune?: string;
  } | null>(null);
  const [parcelleError, setParcelleError] = useState<string | null>(null);
  const [step, setStep] = useState<"map" | "confirm">("map");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const ortho = createOrthoLayer();

    const { lat: effLat, lon: effLon } = resolveCoordOrFrance(lat, lon);
    const center = fromLonLat([effLon, effLat]);
    const markerSource = new VectorSource();
    const markerFeature = new Feature({
      geometry: new Point(center),
    });
    markerFeature.setStyle(
      new Style({
        image: new Icon({
          src: "data:image/svg+xml;utf8," + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="%237c3aed" stroke="white" stroke-width="2">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            </svg>
          `),
          anchor: [0.5, 1],
          scale: 1,
        }),
      })
    );
    markerSource.addFeature(markerFeature);
    markerSourceRef.current = markerSource;

    const vectorLayer = new VectorLayer({
      source: markerSource,
      zIndex: 10,
    });

    const map = new Map({
      target: mapRef.current,
      layers: [ortho, vectorLayer],
      view: new View({
        center,
        zoom: 19,
        projection: "EPSG:3857",
      }),
    });

    // Mise à jour des coordonnées au déplacement du marker
    const handleMarkerChange = () => {
      const geom = markerFeature.getGeometry();
      if (geom) {
        const [l, la] = toLonLat((geom as Point).getCoordinates());
        setCurrentLon(l);
        setCurrentLat(la);
      }
    };
    markerFeature.on("change", handleMarkerChange);

    // Drag manuel du marker — handlers nommés pour nettoyage propre au unmount
    let dragging = false;
    const dragPan = map.getInteractions().getArray().find((i) => i.constructor.name === "DragPan");
    const mapEl = map.getTargetElement();

    const handlePointerDown = (evt: { pixel: number[] }) => {
      const feature = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { hitTolerance: 25 }
      );
      if (feature === markerFeature) {
        dragging = true;
        if (dragPan) dragPan.setActive(false);
        mapEl.style.cursor = "grabbing";
      }
    };

    const handlePointerMove = (evt: { coordinate: number[]; originalEvent?: { preventDefault?: () => void } }) => {
      if (dragging) {
        evt.originalEvent?.preventDefault?.();
        markerFeature.getGeometry()?.setCoordinates(evt.coordinate);
      }
    };

    const handlePointerUp = () => {
      if (dragging) {
        if (dragPan) dragPan.setActive(true);
        mapEl.style.cursor = "";
      }
      dragging = false;
    };

    const keyDown = listen(map, "pointerdown", (evt) => {
      if (evt instanceof MapBrowserEvent) handlePointerDown({ pixel: evt.pixel });
    });
    const keyMove = listen(map, "pointermove", (evt) => {
      if (evt instanceof MapBrowserEvent) handlePointerMove({ coordinate: evt.coordinate, originalEvent: evt.originalEvent });
    });
    const keyUp = listen(map, "pointerup", handlePointerUp);

    mapInstanceRef.current = map;

    return () => {
      unlistenByKey(keyDown);
      unlistenByKey(keyMove);
      unlistenByKey(keyUp);
      markerFeature.un("change", handleMarkerChange);
      mapEl.style.cursor = "";
      map.setTarget(undefined);
      mapInstanceRef.current = null;
      markerSourceRef.current = null;
    };
  }, [lat, lon, addressId]);

  const handleValiderPosition = async () => {
    setParcelleError(null);
    setParcelle(null);
    try {
      const result = await fetchCadastreByPoint(currentLat, currentLon);
      if (result) {
        setParcelle({
          section: result.section,
          numero: result.numero,
          commune: result.commune,
        });
      } else {
        setParcelleError("Parcelle non détectée à cette position.");
      }
      setStep("confirm");
    } catch (e) {
      setParcelleError(
        e instanceof Error ? e.message : "Erreur récupération parcelle"
      );
      setStep("confirm");
    }
  };

  const handleConfirmer = async () => {
    setSaving(true);
    setError(null);
    try {
      const geoNotes = parcelle
        ? `Section ${parcelle.section} — Numéro ${parcelle.numero}`
        : "Parcelle non détectée";
      await verifyPin(addressId, currentLat, currentLon, geoNotes);
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur validation");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="geo-validation-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="geo-validation-modal"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "var(--surface, #1e1e2e)",
          margin: 16,
          borderRadius: "var(--sg-radius-lg)",
          overflow: "hidden",
          boxShadow: "var(--sg-shadow-soft)",
        }}
      >
        <header
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid var(--border, #333)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>
            Valider l&apos;emplacement sur Géoportail
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 24,
              padding: "0 8px",
            }}
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        {step === "map" ? (
          <>
            <div
              ref={mapRef}
              style={{ flex: 1, minHeight: 400 }}
            />
            <div
              style={{
                padding: 16,
                borderTop: "1px solid var(--border, #333)",
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Déplacez le marqueur sur le bâtiment, puis validez.
                {hasNoInitialCoords ? (
                  <span style={{ display: "block", marginTop: 8, maxWidth: 560 }}>
                    Sans coordonnées initiales, la carte est centrée sur la France — positionnez le marqueur sur le
                    bâtiment du client.
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                className="sn-btn sn-btn-primary"
                onClick={handleValiderPosition}
              >
                Valider cette position
              </button>
              <button
                type="button"
                className="sn-btn sn-btn-ghost"
                onClick={onClose}
              >
                Annuler
              </button>
            </div>
          </>
        ) : (
          <div style={{ padding: 24, flex: 1 }}>
            {parcelle ? (
              <p
                style={{
                  color: "var(--success, #22c55e)",
                  fontSize: 15,
                  marginBottom: 16,
                }}
              >
                Parcelle détectée : Section {parcelle.section} — Numéro{" "}
                {parcelle.numero}
                {parcelle.commune && ` — ${parcelle.commune}`}
              </p>
            ) : (
              <p
                style={{
                  color: "var(--warning, #f59e0b)",
                  fontSize: 15,
                  marginBottom: 16,
                }}
              >
                {parcelleError || "Parcelle non détectée à cette position."}
                <br />
                <span style={{ fontSize: 13, opacity: 0.9 }}>
                  Vous pouvez confirmer quand même (emplacement validé manuellement).
                </span>
              </p>
            )}

            {error && (
              <p style={{ color: "var(--error, #ef4444)", marginBottom: 16 }}>
                {error}
              </p>
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                className="sn-btn sn-btn-primary"
                onClick={handleConfirmer}
                disabled={saving}
              >
                {saving ? "Validation…" : "Confirmer"}
              </button>
              <button
                type="button"
                className="sn-btn sn-btn-ghost"
                onClick={() => setStep("map")}
                disabled={saving}
              >
                Modifier la position
              </button>
              <button
                type="button"
                className="sn-btn sn-btn-ghost"
                onClick={onClose}
                disabled={saving}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
