/**
 * CP — Normalisation : leads.status = SIGNED n'est pas un état final (trou noir leads/clients).
 * Migration : CLIENT + project_status SIGNE (vérité métier unique).
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    UPDATE leads
    SET status = 'CLIENT',
        project_status = 'SIGNE'
    WHERE status = 'SIGNED';
  `);
};

export const down = (_pgm) => {
  /* Pas de down : ne pas réintroduire SIGNED en base */
};
