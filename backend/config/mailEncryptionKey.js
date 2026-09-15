// Imported after the environment loader. Never print configuration values.
import { readMailKeyring } from "../services/security/mailKeyring.js";

try {
  readMailKeyring();
  console.log("[MAIL] Configuration de chiffrement validée");
} catch {
  console.error("[MAIL] Configuration de chiffrement absente, invalide ou ambiguë");
  process.exit(1);
}
