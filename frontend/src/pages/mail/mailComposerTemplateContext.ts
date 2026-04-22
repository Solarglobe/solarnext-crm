import { apiFetch } from "../../services/api";
import { getCrmApiBase } from "../../config/crmApiBase";
import { getLeadFullAddress, getLeadName, type Lead } from "../../services/leads.service";
import type { MailRenderContext } from "../../services/mailApi";

/** Même logique que le serveur — prévisualisation locale des variables. */
export function applyTemplateVariablesLocal(template: string, ctx: MailRenderContext): string {
  return String(template).replace(/\{\{([\s\S]*?)\}\}/g, (_, raw) => {
    const parts = String(raw)
      .trim()
      .split(".")
      .map((p) => p.trim())
      .filter(Boolean);
    let cur: unknown = ctx;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur == null || cur === undefined) return "";
    return String(cur);
  });
}

/** Valeurs factices pour prévisualisation des variables dans les réglages. */
export const MOCK_MAIL_RENDER_CONTEXT: MailRenderContext = {
  date: "15 avril 2026",
  user: { name: "Jean Martin", email: "j.martin@exemple.fr" },
  client: { name: "Jean Dupont", email: "j.dupont@email.com" },
  lead: { name: "Projet Martin", email: "contact@projet.fr" },
  project: { address: "12 rue des Lilas, 44000 Nantes" },
  signature: "<p>— Signature fictive —</p>",
};

function clientDisplayName(c: Record<string, unknown>): string {
  const company = c.company_name != null ? String(c.company_name).trim() : "";
  if (company) return company;
  const fn = c.first_name != null ? String(c.first_name).trim() : "";
  const ln = c.last_name != null ? String(c.last_name).trim() : "";
  const joined = [fn, ln].filter(Boolean).join(" ").trim();
  if (joined) return joined;
  const em = c.email != null ? String(c.email).trim() : "";
  return em || "";
}

/**
 * Contexte pour POST /api/mail/templates/:id/render (client/lead/user/projet depuis le CRM).
 */
export async function buildMailComposerRenderContext(args: {
  clientId?: string | null;
  leadId?: string | null;
}): Promise<MailRenderContext> {
  const base = getCrmApiBase();
  const root = base ? `${base}` : "";
  const date = new Date().toLocaleDateString("fr-FR", { dateStyle: "long" });

  const out: MailRenderContext = {
    date,
    user: { name: "", email: "" },
    project: { address: "" },
  };

  try {
    const meRes = await apiFetch(`${root}/auth/me`);
    if (meRes.ok) {
      const me = (await meRes.json()) as { name?: string; email?: string };
      out.user = { name: me.name || me.email || "", email: me.email || "" };
    }
  } catch {
    /* ignore */
  }

  if (args.leadId?.trim()) {
    try {
      const lr = await apiFetch(`${root}/api/leads/${encodeURIComponent(args.leadId.trim())}`);
      if (lr.ok) {
        const lead = (await lr.json()) as Lead;
        out.lead = {
          name: getLeadName(lead),
          email: lead.email?.trim() || "",
        };
        out.project = { address: getLeadFullAddress(lead) };
      }
    } catch {
      /* ignore */
    }
  }

  if (args.clientId?.trim()) {
    try {
      const cr = await apiFetch(`${root}/api/clients/${encodeURIComponent(args.clientId.trim())}`);
      if (cr.ok) {
        const c = (await cr.json()) as Record<string, unknown>;
        out.client = {
          name: clientDisplayName(c),
          email: c.email != null ? String(c.email) : "",
        };
        const addr =
          [c.installation_address_line_1, c.installation_postal_code, c.installation_city]
            .filter((x) => x != null && String(x).trim())
            .map((x) => String(x).trim())
            .join(" ") ||
          [c.address_line_1, c.postal_code, c.city]
            .filter((x) => x != null && String(x).trim())
            .map((x) => String(x).trim())
            .join(" ") ||
          "";
        if (!out.project?.address?.trim()) {
          out.project = { address: addr };
        }
      }
    } catch {
      /* ignore */
    }
  }

  return out;
}
