/**
 * version.ts — Version sémantique des contrats de données SolarNext.
 *
 * Incrémenter à chaque changement de schéma :
 *   - PATCH (x.x.+1) : corrections internes, descriptions, contraintes plus strictes sans casser
 *   - MINOR (x.+1.0) : nouveaux champs optionnels
 *   - MAJOR (+1.0.0) : champ requis ajouté/supprimé, type changé, champ renommé
 *
 * Le backend envoie cette version dans le header X-Schema-Version.
 * Le frontend force un reload si la version change entre deux déploiements.
 */
export const SCHEMA_VERSION = "1.0.0";

/** Entités couvertes par ce package de schémas. */
export const SCHEMA_ENTITIES = [
  "geometry",
  "scenario",
  "lead",
  "study",
  "quote",
  "invoice",
] as const;

export type SchemaEntity = (typeof SCHEMA_ENTITIES)[number];
