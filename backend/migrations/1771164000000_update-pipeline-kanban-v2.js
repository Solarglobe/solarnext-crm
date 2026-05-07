/**
 * Migration : Pipeline Kanban V2
 *
 * Nouveau pipeline cible :
 *   1. Nouveau lead    (NEW)
 *   2. Qualification   (QUALIFIED)
 *   3. RDV planifié    (APPOINTMENT)
 *   4. Étude en cours  (STUDY)        ← nouveau
 *   5. Offre envoyée   (OFFER_SENT)   ← décalé de pos 4 → 5
 *   6. À relancer      (FOLLOW_UP)    ← décalé + "En réflexion" fusionné dedans
 *   7. Signé           (SIGNED)
 *   8. Perdu           (LOST)
 *   9. Injoignable     (CONTACTED)    ← renommé
 *
 * Hypothèse : aucun lead dans IN_REFLECTION (confirmé par l'utilisateur).
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // ── 1. Assigner les codes manquants aux stages existants ──────────────────
  pgm.sql(`
    UPDATE pipeline_stages SET code = 'NEW'
      WHERE code IS NULL AND (name ILIKE '%nouveau%' OR name ILIKE 'new');

    UPDATE pipeline_stages SET code = 'QUALIFIED'
      WHERE code IS NULL AND name ILIKE '%qualif%';

    UPDATE pipeline_stages SET code = 'APPOINTMENT'
      WHERE code IS NULL AND (name ILIKE '%rdv%' OR name ILIKE '%planif%' OR name ILIKE '%appoint%');

    UPDATE pipeline_stages SET code = 'OFFER_SENT'
      WHERE code IS NULL AND (name ILIKE '%offre%' OR name ILIKE '%envoy%' OR name ILIKE '%offer%');

    UPDATE pipeline_stages SET code = 'FOLLOW_UP'
      WHERE code IS NULL
        AND (name ILIKE '%relance%' OR name ILIKE '%follow%' OR name ILIKE '%suivi%'
             OR name ILIKE '%réflexion%' OR name ILIKE '%reflexion%' OR name ILIKE '%attente%');

    UPDATE pipeline_stages SET code = 'LOST'
      WHERE code IS NULL AND (name ILIKE '%perdu%' OR name ILIKE '%lost%');
  `);

  // ── 2. Supprimer les stages "En réflexion" (IN_REFLECTION) ───────────────
  //    Aucun lead dedans (confirmé) — on les retire proprement.
  pgm.sql(`
    DELETE FROM pipeline_stages
    WHERE code = 'IN_REFLECTION'
       OR (code IS NULL
           AND (name ILIKE '%réflexion%' OR name ILIKE '%reflexion%' OR name ILIKE '%reflection%'));
  `);

  // ── 3. Décaler les positions >= 4 pour faire place à STUDY (pos 4) ───────
  pgm.sql(`
    UPDATE pipeline_stages
    SET position = position + 1
    WHERE position >= 4;
  `);

  // ── 4. Insérer "Étude en cours" (STUDY) en position 4 ───────────────────
  //    Idempotent : skip si déjà présent (nom ou code).
  pgm.sql(`
    INSERT INTO pipeline_stages (id, organization_id, name, position, is_closed, code)
    SELECT gen_random_uuid(), o.id, 'Étude en cours', 4, false, 'STUDY'
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = o.id
        AND (ps.code = 'STUDY'
             OR ps.name ILIKE '%étude%'
             OR ps.name ILIKE '%etude%')
    );
  `);

  // ── 5. Renommer "Contacté" → "Injoignable" et assigner code CONTACTED ────
  pgm.sql(`
    UPDATE pipeline_stages
    SET name = 'Injoignable', code = 'CONTACTED'
    WHERE (code IS NULL OR code = 'CONTACTED')
      AND (name ILIKE '%contact%' OR name ILIKE '%injoign%');
  `);
};

export const down = (pgm) => {
  // Supprimer les stages STUDY créés
  pgm.sql(`DELETE FROM pipeline_stages WHERE code = 'STUDY';`);

  // Remettre les positions > 4 à -1
  pgm.sql(`
    UPDATE pipeline_stages
    SET position = position - 1
    WHERE position > 4;
  `);

  // Remettre "Contacté"
  pgm.sql(`
    UPDATE pipeline_stages
    SET name = 'Contacté'
    WHERE code = 'CONTACTED' AND name = 'Injoignable';
  `);
};
