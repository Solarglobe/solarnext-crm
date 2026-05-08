/**
 * CP-BAT-V2 — Power scaling V2 sur pv_batteries
 *
 * Ajoute deux colonnes de cap de puissance système, permettant de modéliser
 * les architectures où qty > 1 n'augmente pas proportionnellement la puissance
 * (onduleur hybride partagé, limite BMS plateforme, etc.).
 *
 * Sémantique du modèle V2 :
 *   scalable = false  → puissance totale = puissance unitaire (ne scale jamais)
 *   scalable = true   → puissance totale = min(qty × unit_kw, max_system_*_kw ?? +∞)
 *
 * Exemples :
 *   Huawei LUNA2000 5 kWh / 2,5 kW, scalable=true, max_system_charge_kw=5
 *     → qty=1 : 2,5 kW | qty=2 : 5 kW | qty=3 : 5 kW (capé par onduleur)
 *   BYD HVM 8,3 kWh / 5 kW, scalable=true, max_system_charge_kw=null
 *     → qty=1 : 5 kW | qty=2 : 10 kW | qty=3 : 15 kW (pur parallèle)
 *   Pylontech US5000 5 kWh / 3,5 kW, scalable=true, max_system_charge_kw=null
 *     → qty=1 : 3,5 kW | qty=2 : 7 kW (parallèle réel via BMS cluster)
 */

export const shorthands = undefined;

/**
 * Utilise du SQL brut avec IF NOT EXISTS pour être idempotent.
 * pgm.addColumn() sans protection crash si la colonne existe déjà
 * (ex. Railway redéploiement, exécution manuelle préalable, pgmigrations désynchronisé).
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pv_batteries
      ADD COLUMN IF NOT EXISTS max_system_charge_kw numeric(6,2),
      ADD COLUMN IF NOT EXISTS max_system_discharge_kw numeric(6,2);
  `);
  pgm.sql(`
    COMMENT ON COLUMN pv_batteries.max_system_charge_kw IS
      'Puissance de charge maximale du système (toutes unités), indépendante de qty. '
      'Si null et scalable=true : puissance = qty × max_charge_kw (pur parallèle). '
      'Si définie : puissance = min(qty × max_charge_kw, max_system_charge_kw).';
  `);
  pgm.sql(`
    COMMENT ON COLUMN pv_batteries.max_system_discharge_kw IS
      'Puissance de décharge maximale du système (toutes unités), indépendante de qty.';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE pv_batteries
      DROP COLUMN IF EXISTS max_system_charge_kw,
      DROP COLUMN IF EXISTS max_system_discharge_kw;
  `);
};
