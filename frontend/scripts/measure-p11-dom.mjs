/**
 * Mesures DOM réelles page P11 (getBoundingClientRect + getComputedStyle).
 * Prérequis : npm run dev (Vite :5173)
 * Commande : node scripts/measure-p11-dom.mjs
 */
import { chromium } from "@playwright/test";

const eco25 = Array.from({ length: 25 }, (_, i) => 1200 + i * 20);
const pay25 = Array.from({ length: 25 }, (_, i) => (i < 7 ? 8000 : 0));
const reste25 = eco25.map((e, i) => pay25[i] - e);

const mockVm = {
  organization: { id: "org-audit", logo_url: null },
  meta: { studyId: "audit-s", versionId: "audit-v" },
  fullReport: {
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
    p11: {
      meta: { client: "Client Audit", ref: "REF-1", date: "2025-01-01" },
      data: {
        capex_ttc: 25000,
        kwc: 9,
        battery_kwh: 0,
        economies_annuelles_25: eco25,
        financing: {
          mode_label: "Financement",
          montant_finance_display: "25 000 €",
          duree_display: "84 mois",
          taeg_display: "3,5 %",
          assurance_display: "—",
          apport_display: "—",
          monthly_payment_eur: 350,
          annual_payment_eur: 4200,
          total_paid_eur: 29400,
          duration_months: 84,
          enabled: true,
        },
        series: {
          economies_annuelles: eco25,
          paiement_annuel: pay25,
          reste_a_charge_annuel: reste25,
        },
        kpi: {
          mensualite_eur: 350,
          total_paid_eur: 29400,
          roi_years: 10,
          reste_moyen_mois_eur: 250,
        },
        post_loan: {
          economies_net_25_eur: 45000,
          mensualite_liberee_eur: 350,
          reste_charge_moyen_mois_eur: 80,
        },
        durations_summary: "84 mois",
      },
    },
  },
};

const PX_TO_MM = 0.264583;

function round2(n) {
  return Math.round(n * 100) / 100;
}

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

  await page.waitForSelector("#p11", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector("#pdf-ready")?.getAttribute("data-status") === "ready",
    null,
    { timeout: 60000 }
  );

  await new Promise((r) => setTimeout(r, 400));

  await page.locator("#p11").scrollIntoViewIfNeeded();
  await new Promise((r) => setTimeout(r, 300));

  const raw = await page.evaluate((PX_TO_MM_IN) => {
    function round2(n) {
      return Math.round(n * 100) / 100;
    }

    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: round2(b.top),
        bottom: round2(b.bottom),
        left: round2(b.left),
        right: round2(b.right),
        width: round2(b.width),
        height: round2(b.height),
        topMm: round2(b.top * PX_TO_MM_IN),
        bottomMm: round2(b.bottom * PX_TO_MM_IN),
        widthMm: round2(b.width * PX_TO_MM_IN),
        heightMm: round2(b.height * PX_TO_MM_IN),
      };
    };

    const sty = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        fontSize: c.fontSize,
        lineHeight: c.lineHeight,
        fontWeight: c.fontWeight,
        letterSpacing: c.letterSpacing,
      };
    };

    const p11 = document.querySelector("#p11");
    const section = document.querySelector("#p11")?.closest("section") || p11?.parentElement;

    const kpiRow = document.querySelector(".p11-read__card--loan");
    const kpiCards = kpiRow ? [...kpiRow.querySelectorAll(".p11-read__row")] : [];

    const pair = document.querySelector(".p11-central");
    const params = document.querySelector("#p11_params_card");
    const post = document.querySelector("#p11_postloan_block");

    const synth = document.querySelector("#p11_quick_table");
    const synthCards = synth ? [...synth.querySelectorAll(".p11-synth__card")] : [];

    const fused = document.querySelector(".p11-foot");
    const fusedLeft = document.querySelector(".p11-foot__left");
    const fusedDur = document.getElementById("p11_durations_block");
    const fusedOutro = document.querySelector(".p11-foot__right");

    const p11Premium = document.querySelector(".p11-premium");

    let maxBottom = 0;
    if (p11Premium) {
      p11Premium.querySelectorAll("*").forEach((n) => {
        const b = n.getBoundingClientRect();
        if (b.bottom > maxBottom) maxBottom = b.bottom;
      });
    }

    const fusedBottom = fused ? fused.getBoundingClientRect().bottom : 0;
    const sectionRect = section ? rect(section) : null;

    const gapBottomPx =
      sectionRect != null && fusedBottom > 0 ? round2(sectionRect.bottom - fusedBottom) : null;

    const kpiTop = kpiRow ? kpiRow.getBoundingClientRect().top : null;
    const bottomZoneHeightPx =
      kpiTop != null && fusedBottom > 0 ? round2(fusedBottom - kpiTop) : null;
    const chartWrap = document.querySelector("#p11_chart_wrap .p11-chart__svg-wrap");

    const rects = {
      A_kpi_row: rect(kpiRow),
      A_kpi_cards: kpiCards.map((el, i) => ({ i: i + 1, ...rect(el) })),
      B_pair: rect(pair),
      B_params: rect(params),
      B_post: rect(post),
      C_synth: rect(synth),
      C_cards: synthCards.map((el, i) => ({ i: i + 1, ...rect(el) })),
      D_fused_line: rect(fused),
      D_fused_left: rect(fusedLeft),
      D_duration: rect(fusedDur),
      D_outro: rect(fusedOutro),
      E_section_p11: rect(p11),
      E_p11_premium: rect(p11Premium),
      F_chart_svg_wrap: rect(chartWrap),
    };

    const typo = {
      kpi: {
        label: sty(document.querySelector("#p11_kpi1_label")),
        val: sty(document.querySelector("#p11_kpi1_val")),
        hint: sty(document.querySelector("#p11_kpi3_label")),
      },
      params: {
        title: sty(params?.querySelector(".p11-engine-bridge__title")),
        label: sty(params?.querySelector(".p11-engine-bridge__label")),
        value: sty(params?.querySelector(".p11-engine-bridge__value")),
      },
      post: {
        title: sty(post?.querySelector(".p11-read__card-title")),
        subtitle: sty(null),
        cardLabel: sty(post?.querySelector(".p11-read__kv .p11-read__label")),
        cardVal: sty(post?.querySelector("#p11_net_25")),
        legal: sty(null),
      },
      synth: {
        title: sty(synth?.querySelector(".p11-synth__title")),
        year: sty(synth?.querySelector(".p11-synth__year")),
        gainResteLabel: sty(synth?.querySelector(".p11-synth__h")),
        amount: sty(synth?.querySelector(".p11-synth__v")),
      },
      fused: {
        repayLabel: sty(document.querySelector(".p11-foot__repay")),
        duration: sty(fusedDur),
        outro: sty(fusedOutro),
      },
    };

    return {
      rects,
      typo,
      gapBottomPx,
      gapBottomMm: gapBottomPx != null ? round2(gapBottomPx * PX_TO_MM_IN) : null,
      bottomZoneHeightPx,
      bottomZoneHeightMm: bottomZoneHeightPx != null ? round2(bottomZoneHeightPx * PX_TO_MM_IN) : null,
      sectionBottomPx: sectionRect?.bottom,
      fusedBottomPx: round2(fusedBottom),
      maxContentBottomPx: round2(maxBottom),
    };
  }, PX_TO_MM);

  await browser.close();

  outputTables(raw);
}

function outputTables(raw) {
  const r = raw.rects;
  const rows = [];

  rows.push({ bloc: "A rangée KPI complète", ...r.A_kpi_row });
  r.A_kpi_cards.forEach((c, idx) => {
    const names = ["Mensualité", "Total échéances", "ROI", "Reste à charge"];
    rows.push({ bloc: `A carte KPI ${names[idx] || idx}`, ...c });
  });
  rows.push({ bloc: "B duo conteneur", ...r.B_pair });
  rows.push({ bloc: "B Paramètres", ...r.B_params });
  rows.push({ bloc: "B Après le prêt", ...r.B_post });
  rows.push({ bloc: "C Synthèse conteneur", ...r.C_synth });
  r.C_cards.forEach((c) => {
    rows.push({ bloc: `C mini-carte synth ${c.i}`, ...c });
  });
  rows.push({ bloc: "D ligne fusionnée complète", ...r.D_fused_line });
  rows.push({ bloc: "D bloc gauche Remboursement", ...r.D_fused_left });
  rows.push({ bloc: "D durée (#p11_durations_block)", ...r.D_duration });
  rows.push({ bloc: "D texte droite (outro)", ...r.D_outro });
  rows.push({ bloc: "E section #p11", ...r.E_section_p11 });
  rows.push({ bloc: "E .p11-premium", ...r.E_p11_premium });
  rows.push({ bloc: "F zone SVG graphique", ...r.F_chart_svg_wrap });

  console.log("\n=== JSON BRUT ===\n");
  console.log(JSON.stringify(raw, null, 2));

  console.log("\n=== A. Rects (extrait tableau) ===\n");
  console.log(
    "| Bloc | top px | bottom px | width px | height px | top mm | bottom mm | height mm |"
  );
  console.log("|------|--------|-----------|----------|-----------|--------|-----------|-----------|");
  for (const row of rows) {
    if (!row.top && row.top !== 0) continue;
    console.log(
      `| ${row.bloc} | ${row.top} | ${row.bottom} | ${row.width} | ${row.height} | ${row.topMm} | ${row.bottomMm} | ${row.heightMm} |`
    );
  }

  console.log("\n=== B. Typo ===\n");
  console.log("| Zone | Élément | font-size | line-height | font-weight | letter-spacing |");
  console.log("|------|---------|-----------|-------------|-------------|----------------|");
  const t = raw.typo;
  const flat = [
    ["KPI", "label", t.kpi.label],
    ["KPI", "valeur", t.kpi.val],
    ["KPI", "hint (ROI)", t.kpi.hint],
    ["Paramètres", "titre", t.params.title],
    ["Paramètres", "label", t.params.label],
    ["Paramètres", "valeur", t.params.value],
    ["Après le prêt", "titre", t.post.title],
    ["Après le prêt", "sous-titre", t.post.subtitle],
    ["Après le prêt", "label carte", t.post.cardLabel],
    ["Après le prêt", "valeur carte", t.post.cardVal],
    ["Après le prêt", "legal", t.post.legal],
    ["Synthèse", "titre section", t.synth.title],
    ["Synthèse", "année", t.synth.year],
    ["Synthèse", "Gain/Reste label", t.synth.gainResteLabel],
    ["Synthèse", "montant", t.synth.amount],
    ["Ligne finale", "Remboursement", t.fused.repayLabel],
    ["Ligne finale", "durée", t.fused.duration],
    ["Ligne finale", "texte droite", t.fused.outro],
  ];
  for (const [zone, el, s] of flat) {
    if (!s) continue;
    console.log(
      `| ${zone} | ${el} | ${s.fontSize} | ${s.lineHeight} | ${s.fontWeight} | ${s.letterSpacing} |`
    );
  }

  console.log("\n=== C. Espace bas ===\n");
  console.log(`bottom zone utile (#p11 section bottom) px: ${raw.sectionBottomPx}`);
  console.log(`bottom dernier bloc (ligne fusionnée) px: ${raw.fusedBottomPx}`);
  console.log(`espace vide (section.bottom - fused.bottom) px: ${raw.gapBottomPx}`);
  console.log(`espace vide mm: ${raw.gapBottomMm}`);
  console.log(`hauteur zone basse (KPI top → fused bottom) px: ${raw.bottomZoneHeightPx}`);
  console.log(`hauteur zone basse mm: ${raw.bottomZoneHeightMm}`);

  console.log("\n=== D. Conclusion factuelle ===\n");
  console.log(
    `Marge récupérable avant overflow (estimation): ${raw.gapBottomMm} mm (si le contenu ne touche pas déjà le bas de #p11).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
