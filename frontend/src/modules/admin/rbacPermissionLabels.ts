/**
 * Libellés métier pour les codes RBAC (admin non technique).
 * Fallback : code + description API si présente.
 */

import type { AdminPermission } from "../../services/admin.api";

export type PermissionDomainKey =
  | "leads"
  | "clients"
  | "studies"
  | "quotes"
  | "billing"
  | "planning"
  | "missions"
  | "admin"
  | "org"
  | "other";

export const DOMAIN_ORDER: PermissionDomainKey[] = [
  "leads",
  "clients",
  "studies",
  "quotes",
  "billing",
  "planning",
  "missions",
  "admin",
  "org",
  "other",
];

export const DOMAIN_TITLES: Record<PermissionDomainKey, string> = {
  leads: "Leads & prospection",
  clients: "Clients & dossiers",
  studies: "Études solaires",
  quotes: "Devis & catalogue",
  billing: "Facturation",
  planning: "Planning & calendrier",
  missions: "Missions terrain",
  admin: "Administration & accès",
  org: "Entreprise",
  other: "Autres",
};

type Entry = { label: string; description: string; domain: PermissionDomainKey };

/** Mapping complet des permissions connues en base (migrations RBAC). */
export const PERMISSION_UI: Record<string, Entry> = {
  "rbac.manage": {
    label: "Gérer les rôles et permissions",
    description: "Créer et modifier les rôles, assigner les droits d’accès.",
    domain: "admin",
  },
  "user.manage": {
    label: "Gérer les utilisateurs",
    description: "Inviter, modifier ou désactiver les comptes utilisateurs.",
    domain: "admin",
  },
  "structure.manage": {
    label: "Gérer agences et équipes",
    description: "Configurer la structure de l’entreprise (agences, équipes).",
    domain: "admin",
  },
  "org.settings.manage": {
    label: "Paramètres organisation",
    description: "Configurer l’entreprise (identité, documents, numérotation) dans Équipes & entreprise.",
    domain: "org",
  },
  "lead.read.self": {
    label: "Voir ses propres leads",
    description: "Consulter uniquement les prospects qui lui sont attribués.",
    domain: "leads",
  },
  "lead.read.all": {
    label: "Voir tous les leads",
    description: "Consulter l’ensemble des prospects de l’entreprise.",
    domain: "leads",
  },
  "lead.create": {
    label: "Créer un lead",
    description: "Ajouter de nouveaux prospects dans le pipeline.",
    domain: "leads",
  },
  "lead.update.self": {
    label: "Modifier ses leads",
    description: "Mettre à jour les prospects qui lui sont attribués.",
    domain: "leads",
  },
  "lead.update.all": {
    label: "Modifier tous les leads",
    description: "Mettre à jour n’importe quel prospect de l’organisation.",
    domain: "leads",
  },
  "client.read.self": {
    label: "Voir ses clients",
    description: "Accéder aux fiches clients liés à ses leads.",
    domain: "clients",
  },
  "client.read.all": {
    label: "Voir tous les clients",
    description: "Consulter toutes les fiches client de l’entreprise.",
    domain: "clients",
  },
  "client.update.self": {
    label: "Modifier ses clients",
    description: "Mettre à jour les dossiers clients dont il est responsable.",
    domain: "clients",
  },
  "client.update.all": {
    label: "Modifier tous les clients",
    description: "Mettre à jour n’importe quelle fiche client.",
    domain: "clients",
  },
  "study.manage": {
    label: "Gérer les études",
    description: "Créer et modifier les études photovoltaïques et leurs versions.",
    domain: "studies",
  },
  "quote.manage": {
    label: "Gérer les devis",
    description: "Créer, modifier et suivre les propositions commerciales.",
    domain: "quotes",
  },
  "QUOTE_CATALOG:READ": {
    label: "Consulter le catalogue devis",
    description: "Voir les articles et prix du catalogue pour monter les devis.",
    domain: "quotes",
  },
  "QUOTE_CATALOG:WRITE": {
    label: "Modifier le catalogue devis",
    description: "Créer, éditer ou activer/désactiver les lignes du catalogue.",
    domain: "quotes",
  },
  "invoice.manage": {
    label: "Gérer la facturation",
    description: "Accéder aux factures et aux éléments de facturation liés aux ventes.",
    domain: "billing",
  },
  "calendar.view.self": {
    label: "Voir son planning",
    description: "Consulter son calendrier personnel et ses rendez-vous.",
    domain: "planning",
  },
  "calendar.view.all": {
    label: "Voir le planning de l’équipe",
    description: "Consulter les calendriers de tous les utilisateurs.",
    domain: "planning",
  },
  "mission.read.self": {
    label: "Voir ses missions",
    description: "Consulter les missions terrain qui lui sont assignées.",
    domain: "missions",
  },
  "mission.read.all": {
    label: "Voir toutes les missions",
    description: "Consulter l’ensemble des missions de l’entreprise.",
    domain: "missions",
  },
  "mission.update.self": {
    label: "Modifier ses missions",
    description: "Mettre à jour le statut et les infos de ses missions.",
    domain: "missions",
  },
  "mission.update.all": {
    label: "Modifier toutes les missions",
    description: "Gérer n’importe quelle mission terrain.",
    domain: "missions",
  },
  "mission.create": {
    label: "Créer des missions",
    description: "Planifier de nouvelles interventions ou visites.",
    domain: "missions",
  },
};

function humanizeCode(code: string): string {
  return code
    .replace(/[:_]/g, " ")
    .replace(/\./g, " · ")
    .trim();
}

function inferDomain(p: AdminPermission): PermissionDomainKey {
  const c = p.code;
  const m = (p.module || "").toLowerCase();
  if (c.startsWith("lead.")) return "leads";
  if (c.startsWith("client.")) return "clients";
  if (c.startsWith("study.") || c === "study.manage") return "studies";
  if (c.startsWith("QUOTE_CATALOG") || c === "quote.manage" || m === "quote") return "quotes";
  if (c.startsWith("invoice") || m === "invoice") return "billing";
  if (c.startsWith("calendar.")) return "planning";
  if (c.startsWith("mission.")) return "missions";
  if (c === "rbac.manage" || c === "user.manage" || c === "structure.manage" || m === "rbac") return "admin";
  if (c.startsWith("org.") || m === "org") return "org";
  return "other";
}

export function getPermissionUi(p: AdminPermission): Entry {
  const mapped = PERMISSION_UI[p.code];
  if (mapped) return mapped;
  const domain = inferDomain(p);
  const desc = (p.description || "").trim();
  return {
    label: humanizeCode(p.code),
    description: desc || "Permission technique — contactez un administrateur pour le détail.",
    domain,
  };
}

export function groupPermissionsByDomain(permissions: AdminPermission[]): Map<PermissionDomainKey, AdminPermission[]> {
  const map = new Map<PermissionDomainKey, AdminPermission[]>();
  for (const key of DOMAIN_ORDER) {
    map.set(key, []);
  }
  for (const p of permissions) {
    const { domain } = getPermissionUi(p);
    const list = map.get(domain) ?? map.get("other")!;
    list.push(p);
  }
  for (const list of map.values()) {
    list.sort((a, b) => getPermissionUi(a).label.localeCompare(getPermissionUi(b).label, "fr"));
  }
  return map;
}
