/**
 * Side-effect: définit PDF_RENDERER_TEST_URL pour les tests PDF (renderer mock).
 * Doit être importé avant le controller/service dans test-pdf-generation.js.
 * Si non défini : utilise une data URL (mock inline) pour que les tests passent sans frontend.
 */
if (!process.env.PDF_RENDERER_TEST_URL) {
  const mockHtml = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>PDF Test</title>",
    "<script>window.__pdf_render_ready = true;</script>",
    "</head><body><div class=\"page\"><h1>SolarNext PDF Test</h1><p>Renderer test page</p>",
    "<div id=\"pdf-ready\" data-status=\"ready\"></div></body></html>",
  ].join("");
  process.env.PDF_RENDERER_TEST_URL =
    "data:text/html;charset=utf-8," + encodeURIComponent(mockHtml);
}
