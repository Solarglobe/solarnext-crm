/**
 * CP-076 — trust proxy Express (IP réelle derrière reverse proxy).
 * Local : laisser désactivé. Prod derrière Nginx/ALB : TRUST_PROXY=1 ou nombre de sauts.
 */

export function applyTrustProxy(app) {
  const tp = process.env.TRUST_PROXY;
  if (tp === "1" || tp === "true") {
    app.set("trust proxy", 1);
    return;
  }
  if (tp != null && /^\d+$/.test(String(tp).trim())) {
    app.set("trust proxy", Number(tp));
  }
}
