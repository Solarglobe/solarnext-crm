/**
 * calc.controller.test.js — Tests unitaires de calculateSmartpitch
 *
 * Stratégie d'isolation :
 *   • mock.module() intercepte db.js (seul import qui throw sans DATABASE_URL).
 *   • consumptionService est stubbé via une closure configurable par test :
 *     chaque test positionne `consumptionBehavior` avant d'appeler le contrôleur.
 *   • Le contrôleur est chargé via await import() APRÈS les mock.module() calls.
 *   • calcResponseBuilder et calcEngineErrors sont des modules purs → imports directs.
 *
 * Couverture :
 *   T1 — form JSON malformé → 500 (chemin parsing, aucun service atteint)
 *   T2 — CalcEngineValidationError(CALC_INVALID_8760_PROFILE) → 400 + shape
 *   T3 — "V12-PATCHED" absent du source (régression C10)
 *   T4 — buildCalcResponse / resolveProductionBlock sont des fonctions pures (contrat A4)
 *   T5 — erreur générique non qualifiée → 500 avec {error, details}
 *
 * Lancer :
 *   node --test backend/tests/controllers/calc.controller.test.js
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Imports purs (pas de DB, pas de HTTP) ────────────────────────────────────
// Ces modules n'ont aucune dépendance à pool → importables avant les mocks.
import {
  CalcEngineValidationError,
  CALC_INVALID_8760_PROFILE,
} from '../../services/calcEngineErrors.js';

// ─── mock.module() — DOIT précéder await import(controller) ──────────────────

// 1) db.js — élimine le throw "DATABASE_URL manquant au démarrage"
mock.module('../../config/db.js', {
  namedExports: {
    pool: {
      query:   async () => ({ rows: [], rowCount: 0 }),
      connect: async () => ({
        query:   async () => ({ rows: [], rowCount: 0 }),
        release: () => {},
      }),
    },
  },
});

// 2) consumptionService — stub configurable par closure.
//    Les tests positionnent `consumptionBehavior` avant d'invoquer le contrôleur.
let consumptionBehavior = 'valid'; // 'valid' | 'throw-calc' | 'throw-generic'

mock.module('../../services/consumptionService.js', {
  namedExports: {
    loadConsumption: (_mergedConso, _csvPath) => {
      if (consumptionBehavior === 'throw-calc') {
        throw new CalcEngineValidationError(
          CALC_INVALID_8760_PROFILE,
          'Profil 8760h invalide (stub de test)'
        );
      }
      if (consumptionBehavior === 'throw-generic') {
        throw new Error('unexpected consumption error');
      }
      // happy-path stub — retourne 8760 tranches valides
      return {
        hourly: new Array(8760).fill(0.5),
        annual_kwh: 4380,
        engine_consumption_source: 'manual-stub',
      };
    },
    applyEquipmentShape: (base, _merged, _hasCsv) => base,
  },
});

// ─── Chargement du contrôleur (après mocks) ───────────────────────────────────
const { calculateSmartpitch } = await import('../../controllers/calc.controller.js');

// ─── Helper — faux req / res Express ─────────────────────────────────────────
function makeReqRes(body = {}, file = null) {
  let statusCode = 200;
  let jsonBody   = null;

  const req = { body, file };
  const res = {
    status(code) { statusCode = code; return this; },
    json(data)   { jsonBody   = data; return this; },
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getBody:   () => jsonBody,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────
describe('calculateSmartpitch — couche HTTP (sans DB, sans HTTP externe)', () => {

  // T1 — JSON malformé dans req.body.form → JSON.parse throw → 500
  //
  // Le contrôleur parse form via JSON.parse (ligne ~115).
  // L'exception est attrapée avant tout appel service.
  // consumptionService n'est jamais atteint.
  it('T1 : form JSON malformé → res.status(500) shape {error, details}', async () => {
    consumptionBehavior = 'valid';
    const { req, res, getStatus, getBody } = makeReqRes({ form: '{invalid{json' });

    await calculateSmartpitch(req, res);

    assert.strictEqual(getStatus(), 500, 'status doit être 500');
    assert.strictEqual(
      getBody().error,
      'Erreur interne SmartPitch',
      'error doit être la phrase canonique du contrôleur'
    );
    assert.ok(
      typeof getBody().details === 'string' && getBody().details.length > 0,
      'details doit être une string non vide (message SyntaxError)'
    );
  });

  // T2 — consumptionService throw CalcEngineValidationError(CALC_INVALID_8760_PROFILE) → 400
  //
  // Le contrôleur mappe explicitement cette erreur sur un 400 structuré
  // (catch block ligne ~1384).
  // form valide → catalog skippé (pas de panel_input) → consumptionService atteint.
  it('T2 : CalcEngineValidationError CALC_INVALID_8760_PROFILE → res.status(400) + code', async () => {
    consumptionBehavior = 'throw-calc';
    const { req, res, getStatus, getBody } = makeReqRes({
      form: JSON.stringify({ params: {} }),
    });

    await calculateSmartpitch(req, res);

    assert.strictEqual(getStatus(), 400, 'status doit être 400 pour CALC_INVALID_8760_PROFILE');
    assert.strictEqual(
      getBody().code,
      CALC_INVALID_8760_PROFILE,
      'code doit être CALC_INVALID_8760_PROFILE'
    );
    assert.ok(
      getBody().calculation_confidence != null,
      'calculation_confidence doit être présent dans la réponse 400'
    );
    consumptionBehavior = 'valid';
  });

  // T3 — "V12-PATCHED" absent du source (régression C10)
  //
  // Ce console.log de debug doit avoir été retiré lors du fix C10.
  // Test statique : pas d'invocation du contrôleur.
  it('T3 : "V12-PATCHED" absent de calc.controller.js (fix C10)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../controllers/calc.controller.js'),
      { encoding: 'utf8', flag: 'r' }
    );
    assert.ok(
      !src.includes('V12-PATCHED'),
      'console.log "V12-PATCHED" doit être absent — vérifier que le fix C10 est appliqué'
    );
  });

  // T4 — buildCalcResponse et resolveProductionBlock sont des fonctions pures (contrat A4)
  //
  // calcResponseBuilder.js ne dépend pas de DB ni de HTTP.
  // Ce test vérifie que la fonction extraite dans le cadre du refactoring DDD
  // est importable et a la bonne signature, indépendamment du contrôleur.
  it('T4 : calcResponseBuilder est importable sans DB et resolveProductionBlock({}) === null', async () => {
    const { buildCalcResponse, resolveProductionBlock } = await import(
      '../../services/calc/calcResponseBuilder.js'
    );

    assert.strictEqual(
      typeof buildCalcResponse,
      'function',
      'buildCalcResponse doit être une fonction exportée'
    );
    assert.strictEqual(
      typeof resolveProductionBlock,
      'function',
      'resolveProductionBlock doit être une fonction exportée'
    );

    // Contexte vide → pas de productionMultiPan, pas de pv.monthly → null
    const result = resolveProductionBlock({});
    assert.strictEqual(
      result,
      null,
      'resolveProductionBlock({}) doit retourner null (aucune source de production)'
    );
  });

  // T5 — Erreur générique (non-CalcEngineValidationError) → 500 avec {error, details}
  //
  // Toute erreur non qualifiée tombant dans le catch du contrôleur doit
  // retourner 500 avec la phrase canonique et le message d'erreur original.
  it('T5 : erreur interne générique → res.status(500) + {error, details} correct', async () => {
    consumptionBehavior = 'throw-generic';
    const { req, res, getStatus, getBody } = makeReqRes({
      form: JSON.stringify({ params: {} }),
    });

    await calculateSmartpitch(req, res);

    assert.strictEqual(getStatus(), 500, 'status doit être 500 pour erreur générique');
    assert.strictEqual(
      getBody().error,
      'Erreur interne SmartPitch',
      'error doit être la phrase canonique'
    );
    assert.strictEqual(
      getBody().details,
      'unexpected consumption error',
      'details doit contenir le message original de l\'erreur'
    );
    consumptionBehavior = 'valid';
  });
});
