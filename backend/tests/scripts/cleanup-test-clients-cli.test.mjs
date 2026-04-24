/**
 * Tests CLI du script cleanup-test-clients (sans dépendre d'une DB joignable pour les cas d'erreur d'usage).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "../../scripts/cleanup-test-clients.mjs");

test("cleanup-test-clients : exit 1 sans --org", () => {
  const r = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
  assert.equal(r.status, 1, `stdout=${r.stdout} stderr=${r.stderr}`);
  const out = `${r.stderr}\n${r.stdout}`;
  assert.match(out, /--org/i);
});

test("cleanup-test-clients : exit 1 si --org n'est pas un UUID", () => {
  const r = spawnSync(process.execPath, [scriptPath, "--org=not-a-uuid"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  const out = `${r.stderr}\n${r.stdout}`;
  assert.match(out, /UUID|invalide/i);
});

test("cleanup-test-clients : dry-run avec UUID valide (échec connexion DB acceptable)", () => {
  const fakeOrg = "00000000-0000-4000-8000-000000000001";
  const r = spawnSync(process.execPath, [scriptPath, `--org=${fakeOrg}`], { encoding: "utf8" });
  if (r.status === 0) {
    assert.match(r.stdout, /DRY-RUN|candidats/i);
    return;
  }
  assert.ok(
    /ECONNREFUSED|connect|timeout|ENOTFOUND|password|authentication/i.test(`${r.stderr}\n${r.stdout}`),
    `unexpected failure: ${r.stderr}\n${r.stdout}`
  );
});

test("cleanup-test-clients : --apply exige même garde usage (--org)", () => {
  const r = spawnSync(process.execPath, [scriptPath, "--apply"], { encoding: "utf8" });
  assert.equal(r.status, 1);
});

test("cleanup-test-clients : --apply avec UUID (DB joignable → APPLY ou erreur connexion)", () => {
  const fakeOrg = "00000000-0000-4000-8000-000000000002";
  const r = spawnSync(process.execPath, [scriptPath, `--org=${fakeOrg}`, "--apply"], { encoding: "utf8" });
  if (r.status === 0) {
    assert.match(r.stdout, /APPLY|Suppression|Rien à supprimer|candidats/i);
    return;
  }
  assert.ok(
    /ECONNREFUSED|connect|timeout|ENOTFOUND|password|authentication/i.test(`${r.stderr}\n${r.stdout}`),
    `unexpected: ${r.stderr}\n${r.stdout}`
  );
});
