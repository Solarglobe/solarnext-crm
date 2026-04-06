import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env.dev") });

const { pool } = await import("../config/db.js");

async function run() {
  const result = await pool.query(`
    SELECT u.id, u.email
    FROM users u
    JOIN rbac_user_roles ur ON ur.user_id = u.id
    JOIN rbac_roles r ON r.id = ur.role_id
    WHERE r.code = 'SALES'
  `);

  if (result.rows.length === 0) {
    console.log("❌ Aucun user SALES trouvé");
  } else {
    console.log("✅ User(s) SALES trouvé(s):");
    console.table(result.rows);
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
