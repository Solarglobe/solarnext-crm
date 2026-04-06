#!/usr/bin/env python3
"""
Calcul du masque d'horizon 360° à partir du MNT LiDAR HD.

Dépendances: rasterio, pyproj (pip install rasterio pyproj)

Usage:
  python compute_horizon_mask.py --manifest manifest.json --lat 48.8566 --lon 2.3522 --step_deg 1 --out horizon_mask.json
"""

import argparse
import hashlib
import json
import math
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlretrieve, build_opener, install_opener, HTTPSHandler

try:
    import rasterio
except ImportError:
    rasterio = None

try:
    from pyproj import CRS, Transformer
    from pyproj import Geod
except ImportError:
    CRS = Transformer = Geod = None


def _check_deps():
    if rasterio is None:
        sys.exit("Erreur: rasterio requis. pip install rasterio")
    if Transformer is None:
        sys.exit("Erreur: pyproj requis. pip install pyproj")


def load_manifest(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _setup_ssl():
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except ImportError:
        pass
    install_opener(build_opener(HTTPSHandler(context=ctx)))


def get_cache_dir() -> Path:
    base = Path(__file__).resolve().parent
    cache = base / ".cache"
    cache.mkdir(exist_ok=True)
    return cache


def download_raster(url: str, cache_dir: Path) -> Path:
    key = hashlib.sha256(url.encode()).hexdigest()[:16]
    ext = ".tif" if "geotiff" in url.lower() or ".tif" in url else ".bin"
    out = cache_dir / f"{key}{ext}"
    if out.exists():
        return out
    urlretrieve(url, out)
    return out


def parse_bbox(bbox_str: str) -> tuple:
    parts = [float(x.strip()) for x in bbox_str.split(",")]
    return (parts[0], parts[1], parts[2], parts[3])  # xmin, ymin, xmax, ymax


def point_in_bbox(x: float, y: float, bbox: tuple) -> bool:
    xmin, ymin, xmax, ymax = bbox
    return xmin <= x <= xmax and ymin <= y <= ymax


def _pick_raster_url(feature: dict) -> str | None:
    props = feature.get("properties") or {}
    hints = feature.get("download_hints") or []
    candidates = []

    # Cherche dans props toutes les valeurs string qui ressemblent à une URL
    for v in props.values():
        if isinstance(v, str):
            candidates.append(v)
    for h in hints:
        if isinstance(h, str):
            candidates.append(h)

    # On accepte uniquement les URLs explicites vers un raster téléchargeable
    # (GeoTIFF principalement). Si rien -> None.
    for c in candidates:
        lc = c.lower()
        if (lc.startswith("http://") or lc.startswith("https://")) and (".tif" in lc or ".tiff" in lc):
            return c
    return None


def sample_elevation(src, x: float, y: float) -> float | None:
    row, col = src.index(x, y)
    if 0 <= row < src.height and 0 <= col < src.width:
        window = rasterio.windows.Window(col, row, 1, 1)
        data = src.read(1, window=window)
        val = float(data[0, 0])
        nodata = src.nodata
        if nodata is not None and (math.isnan(val) or val == nodata):
            return None
        if math.isnan(val) or val < -500 or val > 9000:
            return None
        return val
    return None


def main():
    parser = argparse.ArgumentParser(description="Calcul du masque d'horizon 360° MNT LiDAR HD")
    parser.add_argument("--manifest", required=True, help="Chemin vers manifest.json")
    parser.add_argument("--lat", type=float, required=True, help="Latitude du site (WGS84)")
    parser.add_argument("--lon", type=float, required=True, help="Longitude du site (WGS84)")
    parser.add_argument("--step_deg", type=float, default=1, help="Pas d'azimut en degrés (défaut: 1)")
    parser.add_argument("--out", required=True, help="Fichier JSON de sortie")
    parser.add_argument("--ray_step_m", type=float, default=10, help="Pas le long du rayon en m (défaut: 10)")
    args = parser.parse_args()

    ray_step_m = args.ray_step_m
    if ray_step_m < 5:
        ray_step_m = 5

    _check_deps()
    _setup_ssl()

    manifest = load_manifest(args.manifest)
    meta = manifest.get("meta", {})
    radius_m = float(meta.get("radius_m", 3000))
    source = meta.get("source", "LIDAR_HD")
    features = manifest.get("features", [])

    wgs84 = CRS.from_epsg(4326)
    lamb93 = CRS.from_epsg(2154)
    transformer = Transformer.from_crs(wgs84, lamb93, always_xy=True)
    geod = Geod(ellps="WGS84")

    x_site, y_site = transformer.transform(args.lon, args.lat)

    seen_urls = set()
    tiles = []
    for feat in features:
        url = _pick_raster_url(feat)
        if not url:
            continue
        if url in seen_urls:
            continue
        seen_urls.add(url)
        props = feat.get("properties") or {}
        bbox_str = props.get("bbox", "")
        if not bbox_str:
            continue
        bbox = parse_bbox(bbox_str)
        tiles.append({"url": url, "bbox": bbox})

    if not tiles:
        print("Aucune URL GeoTIFF trouvée dans le manifest. Impossible de calculer le masque d'horizon à partir de ce WFS. Fournir un manifest contenant des URLs raster (GeoTIFF) ou ajouter l'étape PROMPT 2.1 d'acquisition MNT.", file=sys.stderr)
        sys.exit(2)

    cache_dir = get_cache_dir()
    tile_paths = []
    for t in tiles:
        path = download_raster(t["url"], cache_dir)
        tile_paths.append({"path": path, "bbox": t["bbox"]})

    def get_elevation_at(x: float, y: float, datasets: list) -> float | None:
        for i, t in enumerate(tile_paths):
            if point_in_bbox(x, y, t["bbox"]):
                return sample_elevation(datasets[i], x, y)
        return None

    datasets = [rasterio.open(t["path"]) for t in tile_paths]
    try:
        z_site = get_elevation_at(x_site, y_site, datasets)
        if z_site is None:
            z_site = 0.0

        horizon = []
        ray_step = ray_step_m
        azimuths = []
        a = 0
        while a < 360:
            azimuths.append(a)
            a += args.step_deg

        for azimuth in azimuths:
            max_elev_rad = 0.0
            dist = ray_step
            while dist <= radius_m:
                lon2, lat2, _ = geod.fwd(args.lon, args.lat, azimuth, dist)
                x, y = transformer.transform(lon2, lat2)
                z = get_elevation_at(x, y, datasets)
                if z is not None:
                    angle_rad = math.atan((z - z_site) / dist)
                    if angle_rad > max_elev_rad:
                        max_elev_rad = angle_rad
                dist += ray_step

            elevation_deg = math.degrees(max_elev_rad)
            horizon.append({"azimuth": int(round(azimuth)) % 360, "elevation_deg": round(elevation_deg, 2)})

        result = {
            "meta": {
                "lat": args.lat,
                "lon": args.lon,
                "step_deg": args.step_deg,
                "source": source,
                "computed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            },
            "horizon": horizon,
        }

        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"✓ {args.out} ({len(horizon)} azimuts)")
    finally:
        for ds in datasets:
            ds.close()


if __name__ == "__main__":
    main()
