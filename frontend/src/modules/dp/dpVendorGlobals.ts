import "ol/ol.css";

import Feature from "ol/Feature.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import { defaults as defaultControls, Rotate, Zoom } from "ol/control.js";
import { getCenter } from "ol/extent.js";
import GeoJSON from "ol/format/GeoJSON.js";
import LineString from "ol/geom/LineString.js";
import Point from "ol/geom/Point.js";
import Polygon from "ol/geom/Polygon.js";
import { Draw, Modify, Snap } from "ol/interaction.js";
import { Tile as TileLayer, Vector as VectorLayer } from "ol/layer.js";
import { fromLonLat, getPointResolution, toLonLat } from "ol/proj.js";
import { Vector as VectorSource, WMTS as WMTSSource } from "ol/source.js";
import { Circle as CircleStyle, Fill, Icon, Stroke, Style, Text } from "ol/style.js";
import { WMTS as WMTSTileGrid } from "ol/tilegrid.js";
import html2canvas from "html2canvas";
import { apply } from "ol-mapbox-style";
import * as PDFLib from "pdf-lib";

type DpVendorWindow = Window &
  typeof globalThis & {
    ol?: unknown;
    olms?: { apply: typeof apply };
    html2canvas?: typeof html2canvas;
    PDFLib?: typeof PDFLib;
  };

function buildOpenLayersLegacyNamespace() {
  return {
    Map,
    View,
    Feature,
    control: {
      defaults: defaultControls,
      Rotate,
      Zoom,
    },
    extent: {
      getCenter,
    },
    format: {
      GeoJSON,
    },
    geom: {
      LineString,
      Point,
      Polygon,
    },
    interaction: {
      Draw,
      Modify,
      Snap,
    },
    layer: {
      Tile: TileLayer,
      Vector: VectorLayer,
    },
    proj: {
      fromLonLat,
      getPointResolution,
      toLonLat,
    },
    source: {
      Vector: VectorSource,
      WMTS: WMTSSource,
    },
    style: {
      Circle: CircleStyle,
      Fill,
      Icon,
      Stroke,
      Style,
      Text,
    },
    tilegrid: {
      WMTS: WMTSTileGrid,
    },
  };
}

export async function ensureDpVendorGlobals(): Promise<void> {
  if (typeof window === "undefined") return;
  const w = window as DpVendorWindow;
  w.ol = w.ol || buildOpenLayersLegacyNamespace();
  w.olms = w.olms || { apply };
  w.html2canvas = w.html2canvas || html2canvas;
  w.PDFLib = w.PDFLib || PDFLib;
}
