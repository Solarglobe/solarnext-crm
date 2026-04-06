/**
 * Setup PDF Pipeline tests — mock renderer pour CI/CD
 */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, "../../.env.dev"), override: false });
config({ path: resolve(__dirname, "../../.env"), override: false });

if (!process.env.PDF_RENDERER_TEST_URL) {
  const mockHtml = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>PDF Test</title>",
    "<script>window.__pdf_render_ready = true;</script>",
    "</head><body><div class=\"page\"><h1>SolarNext PDF Pipeline Test</h1>",
    "<div id=\"pdf-ready\" data-status=\"ready\"></div></body></html>",
  ].join("");
  process.env.PDF_RENDERER_TEST_URL =
    "data:text/html;charset=utf-8," + encodeURIComponent(mockHtml);
}

// CP-PDF-V2-019 : renderToken nécessite JWT_SECRET
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "pdf-pipeline-test-secret";
}
