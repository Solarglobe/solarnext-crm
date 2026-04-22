/**
 * Garde-fou DEV-only : vérifie que le lock Calpinage v1 existe et est valide.
 * Exit 1 si CALPINAGE_VERSION_LOCK.json absent ou policy.engine_changes manquant.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.join(__dirname, '..', '..', 'backend', 'calpinage-legacy-assets', 'CALPINAGE_VERSION_LOCK.json');

if (!fs.existsSync(lockPath)) {
  console.error('❌ CALPINAGE_VERSION_LOCK.json absent:', lockPath);
  process.exit(1);
}

let lock;
try {
  lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
} catch (e) {
  console.error('❌ CALPINAGE_VERSION_LOCK.json invalide (JSON):', e.message);
  process.exit(1);
}

if (!lock.policy || lock.policy.engine_changes == null) {
  console.error('❌ CALPINAGE_VERSION_LOCK.json: policy.engine_changes requis');
  process.exit(1);
}

console.log('✅ Calpinage lock OK:', lock.name || lock.tag);
