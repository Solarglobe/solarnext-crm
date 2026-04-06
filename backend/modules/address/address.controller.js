/**
 * CP-028 — Controller Address + Geo
 * Toutes les routes exigent JWT + org isolation
 */

import * as addressService from "./address.service.js";
import * as geoService from "./geo.service.js";
// --- GEO ---

export async function geoAutocomplete(req, res) {
  try {
    const q = req.query.q;
    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return res.status(400).json({ error: "Paramètre q requis" });
    }

    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    const country = req.query.country || "FR";

    const data = await geoService.autocomplete(q.trim(), { limit, country });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function geoResolve(req, res) {
  try {
    const { place_id, provider } = req.body || {};
    if (!place_id) {
      return res.status(400).json({ error: "place_id requis" });
    }

    const data = await geoService.resolve(place_id, provider);
    if (!data) {
      return res.status(404).json({
        error: "resolve_not_supported",
        message: "place_id inconnu — utilisez autocomplete comme source unique"
      });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// --- ADDRESSES CRUD ---

export async function createAddress(req, res) {
  try {
    const address = await addressService.createAddress(req, req.body);
    res.status(201).json(address);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

export async function getAddress(req, res) {
  try {
    const address = await addressService.getAddressById(req, req.params.id);
    if (!address) return res.status(404).json({ error: "Adresse non trouvée" });
    res.json(address);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function patchAddress(req, res) {
  try {
    const address = await addressService.updateAddress(req, req.params.id, req.body);
    if (!address) return res.status(404).json({ error: "Adresse non trouvée" });
    res.json(address);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// --- VERIFY-PIN ---

export async function verifyPin(req, res) {
  try {
    const { address_id, lat, lon, geo_notes } = req.body || {};
    if (!address_id) {
      return res.status(400).json({ error: "address_id requis" });
    }

    const address = await addressService.verifyPin(req, address_id, lat, lon, geo_notes);
    if (!address) return res.status(404).json({ error: "Adresse non trouvée" });

    // Retourner l'objet minimal comme dans la spec
    res.json({
      id: address.id,
      lat: address.lat,
      lon: address.lon,
      geo_precision_level: address.geo_precision_level,
      is_geo_verified: address.is_geo_verified,
      geo_verification_method: address.geo_verification_method,
      geo_updated_at: address.geo_updated_at
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
