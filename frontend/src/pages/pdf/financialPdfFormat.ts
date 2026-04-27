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
