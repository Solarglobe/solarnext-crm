/**
 * Libellés facturation côté UI (les codes envoyés à l’API restent en anglais).
 */

/** Rôle API attendu par POST /api/invoices/from-quote/:id */
export type ApiQuoteBillingRole = "STANDARD" | "DEPOSIT" | "BALANCE";

/**
 * Affichage utilisateur du type de facture lié à un devis.
 * - acompte (code API deposit) → « Acompte »
 * - solde (code API correspondant au solde devis) → « Solde »
 * - facture complète → « Facture »
 */
export function formatInvoiceType(type: string | null | undefined): string {
  const r = String(type || "").toUpperCase();
  if (r === "DEPOSIT") return "Acompte";
  if (r === "BALANCE") return "Solde";
  if (r === "STANDARD") return "Facture";
  if (!r) return "—";
  return "—";
}

/**
 * Ligne « Type de facture » dans l’en-tête (avec cas facture hors devis).
 */
export function formatInvoiceTypeHeaderLine(role: string | null | undefined, hasQuote: boolean): string {
  if (!hasQuote) return "Facture libre / standard";
  return formatInvoiceType(role || "STANDARD");
}

/**
 * Libellé bloc « origine devis » (phrase complète).
 */
export function formatInvoiceOriginQuoteType(role: string | null | undefined): string {
  const r = String(role || "STANDARD").toUpperCase();
  if (r === "DEPOSIT") return "Acompte";
  if (r === "BALANCE") return "Solde";
  return "Facture complète depuis le devis";
}

/**
 * Paramètre d’URL ou saisie utilisateur → rôle API (préférer `solde` dans l’URL plutôt que le code technique anglais).
 */
export function billingRoleParamToApi(param: string | null | undefined): ApiQuoteBillingRole | undefined {
  if (param == null || !String(param).trim()) return undefined;
  const u = String(param).trim().toUpperCase();
  if (u === "SOLDE" || u === "BALANCE") return "BALANCE";
  if (u === "ACOMPTE" || u === "DEPOSIT") return "DEPOSIT";
  if (u === "FACTURE" || u === "STANDARD" || u === "COMPLETE" || u === "FULL") return "STANDARD";
  return undefined;
}
