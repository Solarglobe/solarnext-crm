/**
 * Formatage partagé — PDF devis / facture (Playwright).
 * Une seule source de vérité pour montants, dates, TVA, blocs émetteur/destinataire.
 */

export function formatEurUnknown(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${x.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Montants type capture devis (€ collé au montant, style document). */
export function formatEurLeading(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const s = x.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `€\u00a0${s}`;
}

/** Libellé type « TVA 20 % » à partir des totaux globaux (approximation document). */
export function formatTvaRowLabelFromTotals(totalHt: unknown, totalVat: unknown): string {
  const ht = Number(totalHt);
  const vat = Number(totalVat);
  if (!Number.isFinite(ht) || ht <= 0 || !Number.isFinite(vat) || vat < 0) return "TVA";
  const pct = Math.round((vat / ht) * 100);
  if (pct >= 0 && pct <= 100) return `TVA ${pct}\u00a0%`;
  return "TVA";
}

export function formatDateFrLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Date du jour (locale fr-FR), pour bloc signature document. */
export function formatTodayFrDocument(): string {
  try {
    return new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Date du jour JJ/MM/AAAA (ex. 31/03/2026) — bloc signature / validation. */
export function formatTodayFrNumeric(): string {
  try {
    return new Date().toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Texte légal de durée de validité — partagé PDF / page Présenter */
export function quoteValidityHintFr(sentAt: string | null | undefined, validUntil: string | null | undefined): string {
  if (!validUntil) return "Durée de validité : selon conditions indiquées ci-dessous.";
  const end = new Date(validUntil);
  const start = sentAt ? new Date(sentAt) : null;
  if (start && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 3600 * 1000)));
    if (days > 0) {
      return `Ce devis est valable ${days} jour${days > 1 ? "s" : ""} jusqu'au ${formatDateFrLong(validUntil)}.`;
    }
  }
  return `Valable jusqu'au ${formatDateFrLong(validUntil)}.`;
}

/** TVA : taux en fraction (0,2) ou pourcentage (20) selon source DB */
export function formatVatRateDisplay(v: unknown): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n >= 0 && n <= 1) return `${Math.round(n * 100)} %`;
  return `${n} %`;
}

export function buildRecipientTitle(rec: Record<string, unknown> | undefined): string {
  if (!rec) return "Destinataire";
  const company = rec.company_name ? String(rec.company_name).trim() : "";
  const fn = [rec.first_name, rec.last_name].filter(Boolean).join(" ").trim();
  if (company && fn) return `${company} — ${fn}`;
  return company || fn || "Destinataire";
}

export function buildRecipientLines(rec: Record<string, unknown> | undefined): string[] {
  if (!rec) return [];
  const lines: string[] = [];
  const company = rec.company_name ? String(rec.company_name).trim() : "";
  const fn = [rec.first_name, rec.last_name].filter(Boolean).join(" ").trim();
  if (company && fn) {
    lines.push(company);
    lines.push(fn);
  } else if (company) lines.push(company);
  else if (fn) lines.push(fn);
  if (rec.email) lines.push(String(rec.email));
  if (rec.phone) lines.push(`Tél. ${rec.phone}`);
  const addr = rec.address;
  if (typeof addr === "string" && addr.trim()) {
    lines.push(...addr.split(/\n|,/).map((x) => x.trim()).filter(Boolean));
  }
  return lines;
}

/** Identité facture PDF — sans répétition avec les lignes adresse / contact. */
export interface InvoiceRecipientIdentity {
  primary: string;
  secondary: string | null;
}

export function buildInvoiceRecipientIdentity(rec: Record<string, unknown> | undefined): InvoiceRecipientIdentity {
  if (!rec) return { primary: "Destinataire", secondary: null };
  const company = rec.company_name ? String(rec.company_name).trim() : "";
  const fn = [rec.first_name, rec.last_name].filter(Boolean).join(" ").trim();
  if (company && fn) return { primary: company, secondary: fn };
  if (company) return { primary: company, secondary: null };
  if (fn) return { primary: fn, secondary: null };
  return { primary: "Destinataire", secondary: null };
}

function extractRecipientAddressParts(rec: Record<string, unknown> | undefined): {
  streetLines: string[];
  postalCity: string | null;
  country: string | null;
  hasStructuredAddress: boolean;
} {
  if (!rec) return { streetLines: [], postalCity: null, country: null, hasStructuredAddress: false };
  const addr = rec.address;
  if (addr != null && typeof addr === "object" && !Array.isArray(addr)) {
    const o = addr as Record<string, unknown>;
    const l1 = [o.line1, o.line2].filter(Boolean).map((x) => String(x).trim()).join(", ").trim();
    const streetLines = l1 ? [l1] : [];
    const pc = [o.postal_code, o.city].filter(Boolean).map((x) => String(x).trim()).join(" ").trim();
    const postalCity = pc || null;
    const country = o.country ? String(o.country).trim() : null;
    return {
      streetLines,
      postalCity,
      country,
      hasStructuredAddress: true,
    };
  }
  if (typeof addr === "string" && addr.trim()) {
    const parts = addr
      .split(/\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    return { streetLines: parts, postalCity: null, country: null, hasStructuredAddress: false };
  }
  return { streetLines: [], postalCity: null, country: null, hasStructuredAddress: false };
}

/**
 * PDF facture : adresse + pays uniquement (pas de nom / société — déjà dans {@link buildInvoiceRecipientIdentity}).
 */
export function buildInvoiceRecipientAddressLines(rec: Record<string, unknown> | undefined): string[] {
  const { streetLines, postalCity, country } = extractRecipientAddressParts(rec);
  const out: string[] = [];
  for (const s of streetLines) out.push(s);
  if (postalCity) out.push(postalCity);
  if (country) out.push(country);
  return out;
}

/** Email et téléphone — après le bloc adresse. */
export function buildInvoiceRecipientContactLines(rec: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  if (rec?.email) out.push(String(rec.email));
  if (rec?.phone) out.push(String(rec.phone));
  return out;
}

/** True si au moins une ligne d’adresse exploitable (hors email/téléphone). */
export function invoiceRecipientHasAddressLines(rec: Record<string, unknown> | undefined): boolean {
  const { streetLines, postalCity, country } = extractRecipientAddressParts(rec);
  return streetLines.length > 0 || !!postalCity || !!country;
}

/** Date JJ/MM/AAAA — libellés PDF facture (émission / échéance). */
export function formatDateFrSlash(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

/** Ajoute des jours calendaires à une date ISO YYYY-MM-DD (locale alignée facture builder). */
export function addDaysToIsoDate(issueIso: string, days: number): string {
  const d = new Date(String(issueIso).slice(0, 10) + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Échéance affichée : date live ou snapshot si présente ; sinon issue + jours (paramètre org).
 */
export function resolveInvoiceDueDateForPdf(
  liveDue: string | null | undefined,
  snapshotDue: string | null | undefined,
  issueIso: string | null | undefined,
  defaultDueDays: number | null | undefined
): string | null {
  const explicit = liveDue ?? snapshotDue;
  if (explicit != null && String(explicit).trim() !== "") {
    return String(explicit).slice(0, 10);
  }
  const raw = defaultDueDays != null ? Number(defaultDueDays) : 30;
  const days = Number.isFinite(raw) && raw >= 0 ? raw : 30;
  if (!issueIso || String(issueIso).trim() === "") return null;
  return addDaysToIsoDate(String(issueIso).slice(0, 10), days);
}

export interface IssuerLinesOptions {
  /** IBAN / BIC — pertinent surtout pour la facture */
  includeBank?: boolean;
  /**
   * Devis PDF / Présenter : adresse + légal + contact sur peu de lignes ;
   * le nom de l’émetteur est affiché à part (pas de doublon avec un titre en majuscules).
   */
  compactQuotePdf?: boolean;
}

function issuerWebsiteDisplay(raw: string): string {
  let s = String(raw || "").trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/$/, "");
  return s;
}

/** Champ banque exploitable pour le PDF (hors chaîne vide / espaces). */
function bankPdfFieldPresent(v: unknown): boolean {
  if (v == null) return false;
  return String(v).trim() !== "";
}

export function buildIssuerLines(
  issuer: Record<string, unknown> | undefined,
  opts: IssuerLinesOptions = {}
): string[] {
  if (!issuer) return [];

  if (opts.compactQuotePdf === true) {
    const compact: string[] = [];
    const addr = issuer.address as Record<string, string | null> | undefined;
    if (addr) {
      const street = [addr.line1, addr.line2].filter(Boolean).join(", ");
      const cityLine = [addr.postal_code, addr.city].filter(Boolean).join(" ");
      const parts = [street, cityLine, addr.country ? String(addr.country).trim() : ""].filter(Boolean);
      if (parts.length) compact.push(parts.join(" · "));
    }
    const leg: string[] = [];
    if (issuer.siret) leg.push(`SIRET ${issuer.siret}`);
    if (issuer.vat_number) leg.push(`N° TVA ${issuer.vat_number}`);
    if (issuer.rcs) leg.push(`RCS ${issuer.rcs}`);
    if (leg.length) compact.push(leg.join(" · "));
    const contactBits: string[] = [];
    if (issuer.phone) contactBits.push(`Tél. ${issuer.phone}`);
    if (issuer.email) contactBits.push(String(issuer.email));
    if (issuer.website) contactBits.push(issuerWebsiteDisplay(String(issuer.website)));
    if (contactBits.length) compact.push(contactBits.join(" · "));
    return compact;
  }

  const name = String(issuer.display_name || issuer.legal_name || issuer.trade_name || "").trim();
  const lines: string[] = [];
  if (name) lines.push(name);
  const addr = issuer.address as Record<string, string | null> | undefined;
  if (addr) {
    const a = [addr.line1, addr.line2].filter(Boolean).join(", ");
    const city = [addr.postal_code, addr.city].filter(Boolean).join(" ");
    if (a) lines.push(a);
    if (city) lines.push(city);
    if (addr.country) lines.push(String(addr.country));
  }
  const leg: string[] = [];
  if (issuer.siret) leg.push(`SIRET ${issuer.siret}`);
  if (issuer.vat_number) leg.push(`N° TVA ${issuer.vat_number}`);
  if (issuer.rcs) leg.push(`RCS ${issuer.rcs}`);
  if (leg.length) lines.push(leg.join(" · "));
  if (issuer.phone) lines.push(`Tél. ${issuer.phone}`);
  if (issuer.email) lines.push(String(issuer.email));
  if (issuer.website) lines.push(String(issuer.website));
  if (opts.includeBank) {
    const rawBank = issuer.bank as unknown;
    const bank =
      rawBank != null && typeof rawBank === "object" && !Array.isArray(rawBank)
        ? (rawBank as Record<string, unknown>)
        : null;
    if (bank) {
      const nameOk = bankPdfFieldPresent(bank.bank_name);
      const ibanOk = bankPdfFieldPresent(bank.iban);
      const bicOk = bankPdfFieldPresent(bank.bic);
      // Garde-fou : aucune ligne banque si bank_name, iban et bic sont tous vides / null / undefined.
      if (nameOk || ibanOk || bicOk) {
        if (nameOk) lines.push(`Banque : ${String(bank.bank_name).trim()}`);
        if (ibanOk) lines.push(`IBAN ${String(bank.iban).trim()}`);
        if (bicOk) lines.push(`BIC ${String(bank.bic).trim()}`);
      }
    }
  }
  return lines;
}
