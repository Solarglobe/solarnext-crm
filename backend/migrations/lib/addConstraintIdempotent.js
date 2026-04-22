/**
 * Contrainte CHECK/UNIQUE/PRIMARY KEY/FOREIGN KEY idempotente (ré-exécution migrations,
 * p.ex. redémarrage Railway sans crash "constraint already exists").
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 * @param {string} table
 * @param {string} conname
 * @param {string} definitionSql - Sans point-virgule final : p.ex. `CHECK (x > 0)`, `UNIQUE (a,b)`, `PRIMARY KEY (a,b)`
 */
export function addConstraintIdempotent(pgm, table, conname, definitionSql) {
  const t = String(table).replace(/"/g, '""');
  const cIdent = String(conname).replace(/"/g, '""');
  const cLiteral = String(conname).replace(/'/g, "''");
  const def = String(definitionSql).trim();
  pgm.sql(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = '${cLiteral}'
  ) THEN
    ALTER TABLE "${t}"
    ADD CONSTRAINT "${cIdent}"
    ${def};
  END IF;
END $$;`);
}
