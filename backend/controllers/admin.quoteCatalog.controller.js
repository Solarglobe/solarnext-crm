/**
 * CP-QUOTE-002 — Controller API Catalogue devis
 * Org-scoped, validation stricte (cents/bps integers), 409 on unique violation.
 */

import * as quoteCatalogService from "../services/quoteCatalog.service.js";

/** Limite unique description catalogue (texte commercial long) — aligner le frontend sur cette valeur. */
const QUOTE_CATALOG_DESCRIPTION_MAX_CHARS = 8000;

/** Prix HT en centimes (remises = valeurs négatives) — bornes raisonnables (int32-safe). */
const PRICE_HT_CENTS_MIN = -999_999_999;
const PRICE_HT_CENTS_MAX = 999_999_999;

const FORBIDDEN_PATCH = ["organization_id", "id", "created_at", "updated_at", "is_active"];

function orgId(req) {
  return req.user?.organizationId ?? req.user?.organization_id;
}

function toInt(val, defaultVal = 0) {
  if (val === undefined || val === null) return defaultVal;
  const n = Number(val);
  if (Number.isNaN(n)) return undefined;
  return Math.floor(n);
}

function validatePost(body) {
  const errors = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    errors.push("name must be between 2 and 120 characters");
  }
  const category = body.category;
  if (!category || !quoteCatalogService.CATEGORIES.includes(category)) {
    errors.push(
      `category must be one of: ${quoteCatalogService.CATEGORIES.join(", ")}`
    );
  }
  const pricing_mode = body.pricing_mode ?? "FIXED";
  if (!quoteCatalogService.PRICING_MODES.includes(pricing_mode)) {
    errors.push(
      `pricing_mode must be one of: ${quoteCatalogService.PRICING_MODES.join(", ")}`
    );
  }
  const description =
    body.description !== undefined
      ? (typeof body.description === "string" ? body.description : String(body.description))
      : null;
  if (description !== null && description.length > QUOTE_CATALOG_DESCRIPTION_MAX_CHARS) {
    errors.push(`description max ${QUOTE_CATALOG_DESCRIPTION_MAX_CHARS} characters`);
  }
  const sale_price_ht_cents = toInt(body.sale_price_ht_cents, 0);
  if (
    sale_price_ht_cents === undefined ||
    sale_price_ht_cents < PRICE_HT_CENTS_MIN ||
    sale_price_ht_cents > PRICE_HT_CENTS_MAX
  ) {
    errors.push(
      `sale_price_ht_cents must be an integer between ${PRICE_HT_CENTS_MIN} and ${PRICE_HT_CENTS_MAX}`
    );
  }
  const purchase_price_ht_cents = toInt(body.purchase_price_ht_cents, 0);
  if (
    purchase_price_ht_cents === undefined ||
    purchase_price_ht_cents < PRICE_HT_CENTS_MIN ||
    purchase_price_ht_cents > PRICE_HT_CENTS_MAX
  ) {
    errors.push(
      `purchase_price_ht_cents must be an integer between ${PRICE_HT_CENTS_MIN} and ${PRICE_HT_CENTS_MAX}`
    );
  }
  const default_vat_rate_bps = toInt(body.default_vat_rate_bps, 2000);
  if (
    default_vat_rate_bps === undefined ||
    default_vat_rate_bps < 0 ||
    default_vat_rate_bps > 30000
  ) {
    errors.push("default_vat_rate_bps must be between 0 and 30000");
  }
  if (body.is_active !== undefined) {
    errors.push("is_active cannot be set on create; use activate/deactivate endpoints");
  }
  if (errors.length) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      name,
      description: description === "" ? null : description,
      category,
      pricing_mode,
      sale_price_ht_cents: sale_price_ht_cents ?? 0,
      purchase_price_ht_cents: purchase_price_ht_cents ?? 0,
      default_vat_rate_bps: default_vat_rate_bps ?? 2000
    }
  };
}

function validatePatch(body) {
  const errors = [];
  for (const key of FORBIDDEN_PATCH) {
    if (body[key] !== undefined) {
      errors.push(`Field '${key}' is not allowed`);
    }
  }
  const patch = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 120) {
      errors.push("name must be between 2 and 120 characters");
    } else {
      patch.name = name;
    }
  }
  if (body.description !== undefined) {
    const d =
      typeof body.description === "string" ? body.description : String(body.description);
    if (d.length > QUOTE_CATALOG_DESCRIPTION_MAX_CHARS) {
      errors.push(`description max ${QUOTE_CATALOG_DESCRIPTION_MAX_CHARS} characters`);
    } else {
      patch.description = d === "" ? null : d;
    }
  }
  if (body.category !== undefined) {
    if (!quoteCatalogService.CATEGORIES.includes(body.category)) {
      errors.push(
        `category must be one of: ${quoteCatalogService.CATEGORIES.join(", ")}`
      );
    } else {
      patch.category = body.category;
    }
  }
  if (body.pricing_mode !== undefined) {
    if (!quoteCatalogService.PRICING_MODES.includes(body.pricing_mode)) {
      errors.push(
        `pricing_mode must be one of: ${quoteCatalogService.PRICING_MODES.join(", ")}`
      );
    } else {
      patch.pricing_mode = body.pricing_mode;
    }
  }
  if (body.sale_price_ht_cents !== undefined) {
    const v = toInt(body.sale_price_ht_cents);
    if (v === undefined || v < PRICE_HT_CENTS_MIN || v > PRICE_HT_CENTS_MAX) {
      errors.push(
        `sale_price_ht_cents must be an integer between ${PRICE_HT_CENTS_MIN} and ${PRICE_HT_CENTS_MAX}`
      );
    } else patch.sale_price_ht_cents = v;
  }
  if (body.purchase_price_ht_cents !== undefined) {
    const v = toInt(body.purchase_price_ht_cents);
    if (v === undefined || v < PRICE_HT_CENTS_MIN || v > PRICE_HT_CENTS_MAX) {
      errors.push(
        `purchase_price_ht_cents must be an integer between ${PRICE_HT_CENTS_MIN} and ${PRICE_HT_CENTS_MAX}`
      );
    } else patch.purchase_price_ht_cents = v;
  }
  if (body.default_vat_rate_bps !== undefined) {
    const v = toInt(body.default_vat_rate_bps);
    if (v === undefined || v < 0 || v > 30000)
      errors.push("default_vat_rate_bps must be between 0 and 30000");
    else patch.default_vat_rate_bps = v;
  }
  if (errors.length) {
    return { ok: false, errors };
  }
  return { ok: true, data: patch };
}

export async function list(req, res) {
  try {
    const org = orgId(req);
    const includeInactive =
      String(req.query.include_inactive || "").toLowerCase() === "true";
    const q = req.query.q;
    const category = req.query.category;

    const items = await quoteCatalogService.listQuoteCatalogItems({
      orgId: org,
      includeInactive,
      q,
      category
    });
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function create(req, res) {
  try {
    const org = orgId(req);
    const validation = validatePost(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.errors
      });
    }

    const item = await quoteCatalogService.createQuoteCatalogItem({
      orgId: org,
      payload: validation.data
    });
    res.status(201).json({ item });
  } catch (e) {
    const msg = (e.message || "").toLowerCase();
    if (
      msg.includes("unique") ||
      msg.includes("uq_quote_catalog_items_org_name") ||
      e.code === "23505"
    ) {
      return res.status(409).json({
        error: "An item with this name already exists in your organization."
      });
    }
    res.status(500).json({ error: e.message });
  }
}

export async function patch(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const validation = validatePatch(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.errors
      });
    }

    const item = await quoteCatalogService.patchQuoteCatalogItem({
      orgId: org,
      id,
      patch: validation.data
    });
    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ item });
  } catch (e) {
    const msg = (e.message || "").toLowerCase();
    if (
      msg.includes("unique") ||
      msg.includes("uq_quote_catalog_items_org_name") ||
      e.code === "23505"
    ) {
      return res.status(409).json({
        error: "An item with this name already exists in your organization."
      });
    }
    res.status(500).json({ error: e.message });
  }
}

export async function deactivate(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const item = await quoteCatalogService.setQuoteCatalogItemActive({
      orgId: org,
      id,
      isActive: false
    });
    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function activate(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const item = await quoteCatalogService.setQuoteCatalogItemActive({
      orgId: org,
      id,
      isActive: true
    });
    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
