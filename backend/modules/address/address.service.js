/**
 * CP-028 — Service Address CRUD + verify-pin
 * CP-030 — verify-pin crée activité ADDRESS_VERIFIED sur les leads liés
 * Isolation org stricte : organization_id depuis JWT uniquement
 */

import { pool } from "../../config/db.js";
import { createAutoActivity } from "../activities/activity.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * Créer une adresse (org_id forcé depuis JWT)
 */
export async function createAddress(req, body) {
  const org = orgId(req);
  if (!org) throw new Error("Organization requise");

  const {
    label,
    address_line1,
    address_line2,
    postal_code,
    city,
    country_code = "FR",
    formatted_address,
    lat,
    lon,
    geo_provider,
    geo_place_id,
    geo_source,
    geo_precision_level,
    geo_confidence,
    geo_bbox
  } = body;

  const hasCoords = (lat != null && lat !== "") || (lon != null && lon !== "");
  const geoUpdatedAt = hasCoords ? new Date() : null;

  const isAutocompleteFamily =
    geo_source === "autocomplete_pick" ||
    geo_source === "autocomplete_fallback_street" ||
    geo_source === "autocomplete_fallback_city";

  // Règle métier : autocomplete = provisoire, jamais ROOFTOP/MANUAL_PIN sans validation overlay
  let effectivePrecision = geo_precision_level ?? null;
  if (isAutocompleteFamily) {
    if (
      effectivePrecision === "ROOFTOP_BUILDING" ||
      effectivePrecision === "MANUAL_PIN_BUILDING"
    ) {
      effectivePrecision = "HOUSE_NUMBER_INTERPOLATED";
    }
  }

  // Autocomplete = jamais is_geo_verified (validation overlay obligatoire)
  const isVerified =
    geo_source === "manual_map_pending"
      ? false
      : isAutocompleteFamily
        ? false
        : undefined;

  const result = await pool.query(
    `INSERT INTO addresses (
      organization_id, label, address_line1, address_line2, postal_code, city,
      country_code, formatted_address, lat, lon, geo_provider, geo_place_id,
      geo_source, geo_precision_level, geo_confidence, geo_bbox, geo_updated_at, is_geo_verified
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *`,
    [
      org,
      label ?? null,
      address_line1 ?? null,
      address_line2 ?? null,
      postal_code ?? null,
      city ?? null,
      country_code ?? "FR",
      formatted_address ?? null,
      lat ?? null,
      lon ?? null,
      geo_provider ?? null,
      geo_place_id ?? null,
      geo_source ?? null,
      effectivePrecision ?? null,
      geo_confidence ?? null,
      geo_bbox ? JSON.stringify(geo_bbox) : null,
      geoUpdatedAt,
      isVerified ?? false
    ]
  );

  return result.rows[0];
}

/**
 * Mise à jour partielle (org check)
 */
export async function updateAddress(req, id, body) {
  const org = orgId(req);
  if (!org) throw new Error("Organization requise");

  const allowed = [
    "label",
    "address_line1",
    "address_line2",
    "postal_code",
    "city",
    "country_code",
    "formatted_address",
    "lat",
    "lon",
    "geo_provider",
    "geo_place_id",
    "geo_source",
    "geo_precision_level",
    "geo_confidence",
    "geo_bbox",
    "geo_notes"
  ];

  const updates = [];
  const values = [];
  let idx = 1;

  for (const k of allowed) {
    if (body[k] !== undefined) {
      if (k === "geo_bbox" && body[k] != null) {
        updates.push(`${k} = $${idx++}::jsonb`);
        values.push(JSON.stringify(body[k]));
      } else {
        updates.push(`${k} = $${idx++}`);
        values.push(body[k]);
      }
    }
  }

  if (updates.length === 0) {
    const r = await pool.query(
      "SELECT * FROM addresses WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (r.rows.length === 0) return null;
    return r.rows[0];
  }

  // Si lat/lon modifiés → geo_updated_at
  if (body.lat !== undefined || body.lon !== undefined) {
    updates.push("geo_updated_at = now()");
  }
  updates.push("updated_at = now()");

  values.push(id, org);
  const query = `UPDATE addresses SET ${updates.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx++} RETURNING *`;
  const result = await pool.query(query, values);

  return result.rows[0] || null;
}

/**
 * Lire une adresse (org check)
 */
export async function getAddressById(req, id) {
  const org = orgId(req);
  if (!org) throw new Error("Organization requise");

  const result = await pool.query(
    "SELECT * FROM addresses WHERE id = $1 AND organization_id = $2",
    [id, org]
  );

  return result.rows[0] || null;
}

/**
 * Verify-pin : met à jour lat, lon, precision, verified
 * geo_notes optionnel : parcelle cadastrale (ex: "Section AB — Numéro 1234")
 */
export async function verifyPin(req, addressId, lat, lon, geoNotes) {
  const org = orgId(req);
  if (!org) throw new Error("Organization requise");

  if (lat == null || lon == null) {
    throw new Error("lat et lon requis");
  }

  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
    throw new Error("lat et lon doivent être des nombres");
  }
  if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    throw new Error("Coordonnées hors bornes");
  }

  const result = await pool.query(
    `UPDATE addresses SET
      lat = $1, lon = $2,
      geo_precision_level = 'MANUAL_PIN_BUILDING',
      geo_source = 'manual_pin',
      is_geo_verified = true,
      geo_verification_method = 'pin_confirmed',
      geo_updated_at = now(),
      updated_at = now(),
      geo_notes = COALESCE($5, geo_notes)
    WHERE id = $3 AND organization_id = $4
    RETURNING *`,
    [latNum, lonNum, addressId, org, geoNotes || null]
  );

  const address = result.rows[0] || null;
  if (address) {
    const uid = req.user?.userId ?? req.user?.id;
    const leadsRes = await pool.query(
      "SELECT id FROM leads WHERE site_address_id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
      [addressId, org]
    );
    for (const row of leadsRes.rows) {
      try {
        await createAutoActivity(org, row.id, uid, "ADDRESS_VERIFIED", "Emplacement validé (Géoportail)", {
          lat: latNum,
          lon: lonNum,
          cadastre: geoNotes || address.geo_notes || null
        });
      } catch (_) {}
    }
  }
  return address;
}

/**
 * Vérifier que l'adresse appartient à la même org que le lead (validation applicative)
 */
export async function validateAddressForLead(orgId, addressId) {
  if (!addressId) return true;

  const r = await pool.query(
    "SELECT id FROM addresses WHERE id = $1 AND organization_id = $2",
    [addressId, orgId]
  );

  return r.rows.length > 0;
}
