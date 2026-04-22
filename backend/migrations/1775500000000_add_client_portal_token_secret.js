/**
 * Jeton opaque récupérable côté staff (GET) pour réafficher l’URL sans exposer le hash.
 * Les lignes existantes avant migration restent sans secret → régénération nécessaire pour lien affichable.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.addColumn("client_portal_tokens", {
    token_secret: { type: "text" },
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropColumn("client_portal_tokens", "token_secret");
};
