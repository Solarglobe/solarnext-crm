/**
 * Usage (prod container): cd /app/backend && node scripts/checkBillingTrigger.mjs
 * Liste les triggers quotes liés au billing (doit être vide après migration drop).
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query(
  `SELECT tgname FROM pg_trigger WHERE tgrelid = 'quotes'::regclass AND tgname LIKE '%billing%'`
);
console.log(JSON.stringify(r.rows, null, 2));
const fn = await c.query(
  `SELECT proname FROM pg_proc WHERE proname = 'sg_quotes_billing_total_immutable'`
);
console.log("function_sg_quotes_billing_total_immutable_rows:", fn.rows.length);
await c.end();
