#!/usr/bin/env python3
"""
Module offline : récupération du manifest des dalles MNT LiDAR HD via WFS data.geopf.fr.
Aucune dépendance externe (stdlib uniquement).
"""

import argparse
import json
import math
import os
import re
import ssl
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

WFS_BASE = "https://data.geopf.fr/wfs/ows"
WFS_LAYER = "IGNF_MNT-LIDAR-HD:dalle"
WFS_LAYER_FALLBACK = "IGNF_MNH-LIDAR-HD:dalle"
TIMEOUT = 20
MAX_RETRIES = 2
RETRY_DELAYS = [1, 2]

# Regex pour extraire les URLs ou chemins de fichiers (.tif, .zip, .laz)
DOWNLOAD_HINT_PATTERN = re.compile(
    r"https?://[^\s\"'<>]+|"
    r"[^\s\"'<>]*\.(?:tif|tiff|zip|laz)(?:\s|$|[\"'<>])?",
    re.IGNORECASE,
)


def lat_lon_radius_to_bbox(lat: float, lon: float, radius_m: float) -> tuple[float, float, float, float]:
    """Convertit (lat, lon, radius_m) en bbox EPSG:4326 (approx sphérique)."""
    delta_lat = radius_m / 111320.0
    lat_rad = math.radians(lat)
    delta_lon = radius_m / (111320.0 * math.cos(lat_rad))
    min_lat = lat - delta_lat
    max_lat = lat + delta_lat
    min_lon = lon - delta_lon
    max_lon = lon + delta_lon
    return min_lon, min_lat, max_lon, max_lat


def extract_download_hints(properties: dict) -> list[str]:
    """Extrait les chaînes ressemblant à des URLs ou chemins .tif/.zip/.laz."""
    hints: list[str] = []
    seen: set[str] = set()

    def scan_value(val):
        if isinstance(val, str):
            for m in DOWNLOAD_HINT_PATTERN.finditer(val):
                s = m.group(0).strip().rstrip("'\"<>")
                if s and s not in seen:
                    seen.add(s)
                    hints.append(s)
        elif isinstance(val, (list, tuple)):
            for v in val:
                scan_value(v)
        elif isinstance(val, dict):
            for v in val.values():
                scan_value(v)

    scan_value(properties)
    return hints


def bbox_from_geometry(geom: dict | None) -> list[float] | None:
    """Calcule la bbox [minLon, minLat, maxLon, maxLat] depuis une géométrie GeoJSON."""
    if not geom or "coordinates" not in geom:
        return None

    coords = geom["coordinates"]

    def flatten_coords(c):
        if len(c) >= 2 and isinstance(c[0], (int, float)) and isinstance(c[1], (int, float)):
            return [c[:2]]
        return [p for sub in c for p in flatten_coords(sub)]

    flat = flatten_coords(coords)
    if not flat:
        return None

    lons = [p[0] for p in flat]
    lats = [p[1] for p in flat]
    return [min(lons), min(lats), max(lons), max(lats)]


def _build_wfs_params(
    bbox: tuple[float, float, float, float],
    typenames: str,
) -> dict:
    """Construit les paramètres WFS GetFeature (data.geopf.fr).
    BBOX au format EPSG:4326 : minLat,minLon,maxLat,maxLon (ordre lat,lon).
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": typenames,
        "SRSNAME": "EPSG:4326",
        "BBOX": f"{min_lat},{min_lon},{max_lat},{max_lon}",
        "COUNT": 10000,
        "OUTPUTFORMAT": "application/json",
    }
    return params


def fetch_wfs_geojson(
    bbox: tuple[float, float, float, float],
    *,
    typenames: str = WFS_LAYER,
    insecure: bool = False,
) -> dict:
    """Interroge le WFS GetFeature et retourne le GeoJSON parsé.
    BBOX au format EPSG:4326 (minLat,minLon,maxLat,maxLon) sans suffixe.
    """
    params = _build_wfs_params(bbox, typenames)
    url = f"{WFS_BASE}?{urlencode(params, safe=':,')}"
    ssl_ctx = ssl._create_unverified_context() if insecure else ssl.create_default_context()
    last_error = None

    for attempt in range(MAX_RETRIES + 1):
        try:
            req = Request(url, headers={"Accept": "application/json"})
            with urlopen(req, timeout=TIMEOUT, context=ssl_ctx) as resp:
                if resp.status != 200:
                    raise HTTPError(
                        resp.url, resp.status, resp.reason, resp.headers, resp
                    )
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw)
        except HTTPError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAYS[attempt])
            else:
                raise
        except URLError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAYS[attempt])
            else:
                print(f"Erreur réseau: {e.reason}", file=sys.stderr)
                sys.exit(1)
        except json.JSONDecodeError as e:
            print(f"JSON invalide: {e}", file=sys.stderr)
            sys.exit(1)

    if last_error:
        raise last_error
    raise RuntimeError("Impossible d'atteindre le WFS")


def fetch_wfs_with_fallback(
    bbox: tuple[float, float, float, float],
    *,
    insecure: bool = False,
) -> tuple[dict, str]:
    """Interroge le WFS avec fallback automatique si LiDAR HD vide ou rejeté (400/404).
    Retourne (geojson, source) avec source in ("LIDAR_HD", "MNT_FALLBACK").
    """
    try:
        geojson = fetch_wfs_geojson(bbox, typenames=WFS_LAYER, insecure=insecure)
        if geojson.get("features"):
            return geojson, "LIDAR_HD"
    except HTTPError as e:
        if e.code not in (400, 404):
            print(f"Erreur HTTP {e.code}: {e.reason}", file=sys.stderr)
            raise

    # Fallback : couche MNT standard (zone non couverte LiDAR HD)
    print("Zone non couverte LiDAR HD ou rejetée (400/404), utilisation du MNT standard (fallback)", file=sys.stderr)
    geojson = fetch_wfs_geojson(bbox, typenames=WFS_LAYER_FALLBACK, insecure=insecure)
    return geojson, "MNT_FALLBACK"


def build_manifest(
    lat: float,
    lon: float,
    radius_m: float,
    bbox: tuple[float, float, float, float],
    geojson: dict,
    wfs_url: str,
    source: str,
) -> dict:
    """Construit le manifest JSON à partir du GeoJSON WFS."""
    features_raw = geojson.get("features", [])

    features = []
    for i, f in enumerate(features_raw):
        fid = f.get("id", str(i))
        geom = f.get("geometry")
        geom_type = geom.get("type", "Unknown") if geom else None
        props = f.get("properties", {})
        if props is None:
            props = {}

        features.append({
            "id": fid,
            "bbox_epsg4326": bbox_from_geometry(geom),
            "properties": dict(props),
            "download_hints": extract_download_hints(props),
            "geometry_type": geom_type,
        })

    return {
        "meta": {
            "lat": lat,
            "lon": lon,
            "radius_m": radius_m,
            "bbox_epsg4326": list(bbox),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "wfs_url": wfs_url,
            "source": source,
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Récupère le manifest des dalles MNT LiDAR HD intersectant une zone (WFS data.geopf.fr)"
    )
    parser.add_argument("--lat", type=float, required=True, help="Latitude (EPSG:4326)")
    parser.add_argument("--lon", type=float, required=True, help="Longitude (EPSG:4326)")
    parser.add_argument("--radius_m", type=float, required=True, help="Rayon en mètres")
    parser.add_argument(
        "--out",
        type=str,
        required=True,
        help="Chemin du fichier manifest.json de sortie",
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Désactive la vérification SSL (DEV uniquement)",
    )
    args = parser.parse_args()

    bbox = lat_lon_radius_to_bbox(args.lat, args.lon, args.radius_m)
    geojson, source = fetch_wfs_with_fallback(bbox, insecure=args.insecure)

    typenames = WFS_LAYER if source == "LIDAR_HD" else WFS_LAYER_FALLBACK
    params = _build_wfs_params(bbox, typenames)
    wfs_url = f"{WFS_BASE}?{urlencode(params, safe=':,')}"

    manifest = build_manifest(
        args.lat, args.lon, args.radius_m, bbox, geojson, wfs_url, source
    )

    out_path = args.out
    out_dir = os.path.dirname(out_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"Manifest écrit: {out_path} ({len(manifest['features'])} dalles)")


if __name__ == "__main__":
    main()
