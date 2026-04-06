/**
 * Mesures DOM réelles (getBoundingClientRect) pour audit P7 vs P10.
 * Prérequis : npm run dev (Vite :5173)
 * Commande : node scripts/measure-p7-p10-dom.mjs
 */
import { chromium } from "@playwright/test";

const mockVm = {
  organization: { id: "org-audit", logo_url: null },
  meta: { studyId: "audit-s", versionId: "audit-v" },
  fullReport: {
    p7: {
      meta: { client: "Client Audit", ref: "REF-1", date: "2025-01-01" },
      pct: {
        c_pv_pct: 50,
        c_bat_pct: 0,
        c_grid_pct: 50,
        p_auto_pct: 40,
        p_bat_pct: 0,
        p_surplus_pct: 60,
      },
      consumption_kwh: 5000,
      autoconsumption_kwh: 2000,
      production_kwh: 8000,
      p_surplus: 1000,
      c_grid: 0,
    },
    p10: {
      meta: { client: "Client Audit", ref: "REF-1", date: "2025-01-01" },
      best: {
        kwc: 9.7,
        savings_year1_eur: 3500,
        roi_years: 8,
        autonomy_pct: 47,
        tri_pct: 5,
        lcoe_eur_kwh: 0.12,
        gains_25_eur: 50000,
        nb_panels: 20,
        annual_production_kwh: 10000,
        autoprod_pct: 60,
      },
    },
  },
};

async function main() {
  const base = process.env.PDF_AUDIT_URL || "http://127.0.0.1:5173";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 2400 });

  await page.route("**/api/studies/*/versions/*/pdf-view-model", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, viewModel: mockVm }),
    });
  });

  const url = `${base}/pdf-render.html?studyId=audit-s&versionId=audit-v`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });

  await page.waitForSelector("#p7", { timeout: 60000 });
  await page.waitForSelector("#p10", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector("#pdf-ready")?.getAttribute("data-status") === "ready",
    null,
    { timeout: 60000 }
  );

  await page.evaluate(() => window.scrollTo(0, 0));

  const out = await page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top * 100) / 100,
        bottom: Math.round(b.bottom * 100) / 100,
        left: Math.round(b.left * 100) / 100,
        right: Math.round(b.right * 100) / 100,
        width: Math.round(b.width * 100) / 100,
        height: Math.round(b.height * 100) / 100,
      };
    };

    const p7 = document.querySelector("#p7");
    const p10 = document.querySelector("#p10");

    const p7Header = p7?.querySelector(".header");
    const p7Bar = p7?.querySelector(".bar");
    const p7Intro = p7?.querySelector("p");
    const p7Kids = p7 ? [...p7.children] : [];
    const p7FirstUnderBar = p7Kids.find((c) => !c.classList.contains("header") && !c.classList.contains("bar"));

    const p7BottomMost = p7
      ? [...p7.querySelectorAll("*")].reduce((a, b) =>
          a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b
        )
      : null;

    const p10Header = p10?.querySelector(".header");
    const p10Bar = p10?.querySelector(".bar");
    const p10Main = p10?.querySelector(".p10-main");
    const ch = p10Main ? [...p10Main.children] : [];
    const p10Hero = ch[0];
    const p10Kpi = ch[1];
    const p10Black = ch[2];
    const p10Grid2 = ch[3];
    const p10Final = ch[4];

    const p10BottomMost = p10
      ? [...p10.querySelectorAll("*")].reduce((a, b) =>
          a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b
        )
      : null;

    const sec7 = rect(p7);
    const sec10 = rect(p10);
    const last7 = rect(p7BottomMost);
    const last10 = rect(p10BottomMost);

    const first7 = rect(p7FirstUnderBar || p7Intro);
    const first10 = rect(p10Hero);

    const table = [
      { page: "P7", element: "#p7", ...rect(p7) },
      { page: "P7", element: "header", ...rect(p7Header) },
      { page: "P7", element: "bar", ...rect(p7Bar) },
      { page: "P7", element: "intro p", ...rect(p7Intro) },
      { page: "P7", element: "premier bloc sous barre", ...rect(p7FirstUnderBar) },
      { page: "P7", element: "dernier nœud le plus bas (tous descendants)", ...last7 },
      { page: "P10", element: "#p10", ...rect(p10) },
      { page: "P10", element: "header", ...rect(p10Header) },
      { page: "P10", element: "bar", ...rect(p10Bar) },
      { page: "P10", element: ".p10-main", ...rect(p10Main) },
      { page: "P10", element: "hero", ...rect(p10Hero) },
      { page: "P10", element: "grille KPI", ...rect(p10Kpi) },
      { page: "P10", element: "bandeau noir ROI", ...rect(p10Black) },
      { page: "P10", element: "grille 2 col", ...rect(p10Grid2) },
      { page: "P10", element: "bandeau final", ...rect(p10Final) },
      { page: "P10", element: "dernier nœud le plus bas (tous descendants)", ...last10 },
    ];

    const bottomGap7 = sec7 && last7 ? sec7.bottom - last7.bottom : null;
    const bottomGap10 = sec10 && last10 ? sec10.bottom - last10.bottom : null;

    const leftGap7 = sec7 && first7 ? first7.left - sec7.left : null;
    const rightGap7 = sec7 && first7 ? sec7.right - first7.right : null;
    const leftGap10 = sec10 && first10 ? first10.left - sec10.left : null;
    const rightGap10 = sec10 && first10 ? sec10.right - first10.right : null;

    const innerUsedH7 = last7 && sec7 ? last7.bottom - sec7.top : null;
    const innerUsedH10 = last10 && sec10 ? last10.bottom - sec10.top : null;

    return {
      table,
      summary: {
        p7: {
          sectionHeightPx: sec7?.height,
          sectionWidthPx: sec7?.width,
          bottomGapPx: bottomGap7,
          leftInsetPx: leftGap7,
          rightInsetPx: rightGap7,
          contentUsedHeightPx: innerUsedH7,
        },
        p10: {
          sectionHeightPx: sec10?.height,
          sectionWidthPx: sec10?.width,
          bottomGapPx: bottomGap10,
          leftInsetPx: leftGap10,
          rightInsetPx: rightGap10,
          contentUsedHeightPx: innerUsedH10,
        },
        grid2BottomVsSectionBottomPx:
          sec10 && rect(p10Grid2) ? sec10.bottom - rect(p10Grid2).bottom : null,
      },
    };
  });

  const mmPerPx = 25.4 / 96;
  out.summary.p7.bottomGapMm = out.summary.p7.bottomGapPx * mmPerPx;
  out.summary.p10.bottomGapMm = out.summary.p10.bottomGapPx * mmPerPx;
  out.mmPerPx = mmPerPx;

  console.log(JSON.stringify(out, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
